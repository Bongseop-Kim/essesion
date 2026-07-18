"""GCS 서명 URL 발급과 객체 정리.

고객 첨부는 비공개 업로드 버킷에서 signed read를 사용하고, 상품 이미지는 공개
assets 버킷에 직접 업로드한다. 서명은 IAM signBlob(네트워크), 메타데이터 조회와
삭제는 blocking IO라 threadpool로 실행한다.
로컬은 gcs_emulator_host(docker compose의 fake-gcs-server)를 지정하면 같은
RealGcsClient 경로를 탄다 — 서명만 생략하고 에뮬레이터가 서명을 검증하지 않는
URL을 발급한다. 버킷 미설정 시 local/test는 DryRun(no-op), 그 밖의 환경은
가짜 URL을 반환하지 않고 capability unavailable(503)로 실패한다.
"""

import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Never, Protocol
from urllib.parse import quote

from starlette.concurrency import run_in_threadpool

from api.config import Settings
from api.errors import ServiceUnavailableError

logger = logging.getLogger(__name__)

UPLOAD_URL_TTL = timedelta(minutes=15)
READ_URL_TTL = timedelta(minutes=15)


def assets_bucket_name(settings: Settings) -> str | None:
    """Return the configured public-assets bucket without guessing in deployed envs."""

    if settings.gcs_assets_bucket:
        return settings.gcs_assets_bucket
    if settings.env in ("local", "test") and not settings.gcs_upload_bucket:
        if settings.gcp_project_id:
            return f"{settings.gcp_project_id}-assets"
        return "dry-run-assets"
    return None


def assets_capability_mode(settings: Settings) -> str:
    if settings.gcs_assets_bucket:
        return "real"
    if settings.env in ("local", "test") and not settings.gcs_upload_bucket:
        return "dry_run"
    return "unavailable"


def public_asset_url(settings: Settings, object_key: str) -> str | None:
    """Build one canonical public URL from the configured assets origin."""

    if not object_key:
        return None
    if settings.gcs_assets_public_base_url:
        base_url = settings.gcs_assets_public_base_url.rstrip("/")
    elif settings.gcs_emulator_host and (bucket := assets_bucket_name(settings)):
        base_url = f"{settings.gcs_emulator_host.rstrip('/')}/{bucket}"
    elif bucket := assets_bucket_name(settings):
        base_url = f"https://storage.googleapis.com/{bucket}"
    elif settings.env in ("local", "test") and not settings.gcs_upload_bucket:
        base_url = "https://storage.googleapis.example/public"
    else:
        return None
    return f"{base_url}/{quote(object_key, safe='/')}"


@dataclass(frozen=True)
class GcsObjectMetadata:
    size_bytes: int
    content_type: str | None


class GcsClient(Protocol):
    upload_required: bool
    capability_mode: str

    async def signed_upload_url(
        self,
        object_key: str,
        content_type: str,
        *,
        max_size_bytes: int | None = None,
        bucket_name: str | None = None,
        create_only: bool = False,
    ) -> str: ...

    async def signed_read_url(self, object_key: str) -> str: ...

    async def delete_object(self, object_key: str, *, bucket_name: str | None = None) -> bool: ...

    async def object_metadata(
        self, object_key: str, *, bucket_name: str | None = None
    ) -> GcsObjectMetadata | None: ...

    async def copy_from_bucket(
        self, source_bucket: str, source_key: str, destination_key: str
    ) -> bool: ...


class RealGcsClient:
    upload_required = True
    capability_mode = "real"

    def __init__(self, bucket_name: str, emulator_host: str = ""):
        from google.cloud import storage

        self._emulator_host = emulator_host.rstrip("/")
        if self._emulator_host:
            from google.auth.credentials import AnonymousCredentials

            self._client = storage.Client(
                project="local",
                credentials=AnonymousCredentials(),
                client_options={"api_endpoint": self._emulator_host},
            )
        else:
            self._client = storage.Client()
        self._bucket_name = bucket_name
        self._bucket = self._client.bucket(bucket_name)

    def _emulator_url(self, bucket_name: str, object_key: str, *, upload: bool = False) -> str:
        url = f"{self._emulator_host}/{bucket_name}/{quote(object_key, safe='/')}"
        if upload:
            # fake-gcs-server는 서명을 검증하지 않지만, X-Goog-Algorithm 쿼리가
            # 있어야 PUT을 signed-URL 업로드로 라우팅한다.
            url += "?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=emulator"
        return url

    async def signed_upload_url(
        self,
        object_key: str,
        content_type: str,
        *,
        max_size_bytes: int | None = None,
        bucket_name: str | None = None,
        create_only: bool = False,
    ) -> str:
        if self._emulator_host:
            return self._emulator_url(bucket_name or self._bucket_name, object_key, upload=True)
        bucket = self._client.bucket(bucket_name) if bucket_name else self._bucket
        blob = bucket.blob(object_key)
        headers = (
            {"x-goog-content-length-range": f"1,{max_size_bytes}"}
            if max_size_bytes is not None
            else {}
        )
        if create_only:
            # The staging key must be immutable for the full signed-URL lifetime.
            # Signing this precondition makes a replayed PUT fail once generation 1 exists.
            headers["x-goog-if-generation-match"] = "0"
        return await run_in_threadpool(
            blob.generate_signed_url,
            version="v4",
            expiration=UPLOAD_URL_TTL,
            method="PUT",
            content_type=content_type,
            headers=headers,
        )

    async def signed_read_url(self, object_key: str) -> str:
        if self._emulator_host:
            return self._emulator_url(self._bucket_name, object_key)
        blob = self._bucket.blob(object_key)
        return await run_in_threadpool(
            blob.generate_signed_url,
            version="v4",
            expiration=READ_URL_TTL,
            method="GET",
        )

    async def delete_object(self, object_key: str, *, bucket_name: str | None = None) -> bool:
        from google.cloud.exceptions import NotFound

        bucket = self._client.bucket(bucket_name) if bucket_name else self._bucket

        def _delete() -> bool:
            try:
                bucket.blob(object_key).delete()
            except NotFound:
                pass  # 이미 없음 = 삭제 목적 달성(멱등)
            return True

        try:
            return await run_in_threadpool(_delete)
        except Exception:
            logger.exception("GCS 삭제 실패: %s", object_key)
            return False

    async def object_metadata(
        self, object_key: str, *, bucket_name: str | None = None
    ) -> GcsObjectMetadata | None:
        from google.cloud.exceptions import NotFound

        bucket = self._client.bucket(bucket_name) if bucket_name else self._bucket

        def _load() -> GcsObjectMetadata | None:
            blob = bucket.blob(object_key)
            try:
                blob.reload()
            except NotFound:
                return None
            return GcsObjectMetadata(size_bytes=int(blob.size or 0), content_type=blob.content_type)

        return await run_in_threadpool(_load)

    async def copy_from_bucket(
        self, source_bucket: str, source_key: str, destination_key: str
    ) -> bool:
        """공개 생성물을 비공개 업로드 버킷으로 복사한다.

        호출자가 DB 소유권과 대상 키 정책을 먼저 검증한다. 대상 객체가 이미 있으면
        성공으로 취급해 동시 create-only 복사에서도 기존 객체를 덮어쓰지 않는다.
        """

        from google.cloud.exceptions import PreconditionFailed

        def _copy() -> None:
            source = self._client.bucket(source_bucket)
            source.copy_blob(
                source.blob(source_key),
                self._bucket,
                destination_key,
                if_generation_match=0,
            )

        try:
            await run_in_threadpool(_copy)
            return True
        except PreconditionFailed:
            # 같은 잡의 대상 객체가 이미 있으면 복사 목적을 달성한 것(동시 요청 포함).
            return True
        except Exception:
            logger.exception(
                "GCS 버킷 간 복사 실패: gs://%s/%s -> %s",
                source_bucket,
                source_key,
                destination_key,
            )
            return False


class DryRunGcsClient:
    upload_required = False
    capability_mode = "dry_run"

    def __init__(self) -> None:
        self.deleted: list[str] = []
        self.deleted_from: list[tuple[str | None, str]] = []
        self.copied: list[tuple[str, str, str]] = []

    async def signed_upload_url(
        self,
        object_key: str,
        content_type: str,
        *,
        max_size_bytes: int | None = None,
        bucket_name: str | None = None,
        create_only: bool = False,
    ) -> str:
        logger.info("DRYRUN gcs signed url: %s (%s)", object_key, content_type)
        if bucket_name:
            return f"https://storage.googleapis.example/dry-run/{bucket_name}/{object_key}"
        return f"https://storage.googleapis.example/dry-run/{object_key}"

    async def signed_read_url(self, object_key: str) -> str:
        logger.info("DRYRUN gcs read url: %s", object_key)
        return f"https://storage.googleapis.example/dry-run/{object_key}"

    async def delete_object(self, object_key: str, *, bucket_name: str | None = None) -> bool:
        logger.info("DRYRUN gcs delete: %s", object_key)
        self.deleted.append(object_key)
        self.deleted_from.append((bucket_name, object_key))
        return True

    async def object_metadata(
        self, object_key: str, *, bucket_name: str | None = None
    ) -> GcsObjectMetadata | None:
        return None

    async def copy_from_bucket(
        self, source_bucket: str, source_key: str, destination_key: str
    ) -> bool:
        logger.info(
            "DRYRUN gcs copy: gs://%s/%s -> %s",
            source_bucket,
            source_key,
            destination_key,
        )
        self.copied.append((source_bucket, source_key, destination_key))
        return True


class UnavailableGcsClient:
    upload_required = True
    capability_mode = "unavailable"

    @staticmethod
    def _raise() -> Never:
        raise ServiceUnavailableError(
            "파일 저장 기능을 사용할 수 없습니다.", code="gcs_unavailable"
        )

    async def signed_upload_url(
        self,
        object_key: str,
        content_type: str,
        *,
        max_size_bytes: int | None = None,
        bucket_name: str | None = None,
        create_only: bool = False,
    ) -> str:
        self._raise()

    async def signed_read_url(self, object_key: str) -> str:
        self._raise()

    async def delete_object(self, object_key: str, *, bucket_name: str | None = None) -> bool:
        self._raise()

    async def object_metadata(
        self, object_key: str, *, bucket_name: str | None = None
    ) -> GcsObjectMetadata | None:
        self._raise()

    async def copy_from_bucket(
        self, source_bucket: str, source_key: str, destination_key: str
    ) -> bool:
        self._raise()


def build_gcs_client(settings: Settings) -> GcsClient:
    if settings.gcs_emulator_host and settings.env not in ("local", "test"):
        # 서명·인가가 없는 에뮬레이터 경로가 배포 환경에 섞이지 않도록 fail-closed
        raise RuntimeError("GCS_EMULATOR_HOST는 local/test 전용입니다")
    if settings.gcs_upload_bucket:
        return RealGcsClient(settings.gcs_upload_bucket, emulator_host=settings.gcs_emulator_host)
    if settings.env in ("local", "test"):
        logger.warning("GCS_UPLOAD_BUCKET 없음 — local/test DryRun GCS 클라이언트로 동작")
        return DryRunGcsClient()
    logger.error("GCS_UPLOAD_BUCKET 없음 — GCS capability unavailable")
    return UnavailableGcsClient()
