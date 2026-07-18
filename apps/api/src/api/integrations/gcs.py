"""GCS 서명 URL 발급과 객체 정리.

고객 첨부는 비공개 업로드 버킷에서 signed read를 사용하고, 상품 이미지는 공개
assets 버킷에 직접 업로드한다. 서명은 IAM signBlob(네트워크), 메타데이터 조회와
삭제는 blocking IO라 threadpool로 실행한다.
버킷 미설정 시 local/test는 local_storage_dir이 있으면 로컬 디스크 저장·서빙
(LocalGcsClient + /local-storage 라우트), 비어 있으면 DryRun(no-op)한다.
그 밖의 환경은 가짜 URL을 반환하지 않고 capability unavailable(503)로 실패한다.
"""

import logging
import mimetypes
import re
import shutil
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Never, Protocol
from urllib.parse import quote, urlencode

from starlette.concurrency import run_in_threadpool

from api.config import Settings
from api.errors import ServiceUnavailableError

logger = logging.getLogger(__name__)

UPLOAD_URL_TTL = timedelta(minutes=15)
READ_URL_TTL = timedelta(minutes=15)

# 로컬 스토리지 레이아웃: <local_storage_dir>/<bucket>/<object_key>
# 비공개 업로드 버킷은 아래 디렉터리명으로 대응된다 (worker의 공개 assets는 dry-run-assets).
LOCAL_UPLOADS_BUCKET = "dry-run-uploads"
LOCAL_STORAGE_PREFIX = "/local-storage"
LOCAL_CTYPE_SUFFIX = ".ctype"  # 콘텐츠 타입 사이드카 — 확장자 추정보다 업로드 헤더가 정확
_LOCAL_BUCKET_RE = re.compile(r"^[A-Za-z0-9._-]{1,63}$")


def _uses_local_storage(settings: Settings) -> bool:
    return (
        settings.env in ("local", "test")
        and not settings.gcs_upload_bucket
        and bool(settings.local_storage_dir)
    )


def local_storage_root(settings: Settings) -> Path:
    return Path(settings.local_storage_dir).resolve()


def local_object_path(root: Path, bucket: str, object_key: str) -> Path:
    """로컬 객체의 디스크 경로 — 경로 이탈은 ValueError로 거부한다."""
    if not _LOCAL_BUCKET_RE.match(bucket):
        raise ValueError(f"invalid bucket: {bucket!r}")
    if not object_key or object_key.endswith(LOCAL_CTYPE_SUFFIX):
        raise ValueError(f"invalid object key: {object_key!r}")
    parts = object_key.split("/")
    if any(part in ("", ".", "..") or "\\" in part for part in parts):
        raise ValueError(f"invalid object key: {object_key!r}")
    path = root.joinpath(bucket, *parts)
    if not path.resolve().is_relative_to(root):
        raise ValueError(f"object key escapes storage root: {object_key!r}")
    return path


def local_object_content_type(path: Path, object_key: str) -> str:
    sidecar = Path(f"{path}{LOCAL_CTYPE_SUFFIX}")
    if sidecar.is_file():
        recorded = sidecar.read_text().strip()
        if recorded:
            return recorded
    return mimetypes.guess_type(object_key)[0] or "application/octet-stream"


def write_local_object(path: Path, data: bytes, content_type: str | None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    if content_type:
        Path(f"{path}{LOCAL_CTYPE_SUFFIX}").write_text(content_type)


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
        return "local" if settings.local_storage_dir else "dry_run"
    return "unavailable"


def public_asset_url(settings: Settings, object_key: str) -> str | None:
    """Build one canonical public URL from the configured assets origin."""

    if not object_key:
        return None
    if settings.gcs_assets_public_base_url:
        base_url = settings.gcs_assets_public_base_url.rstrip("/")
    elif not settings.gcs_assets_bucket and _uses_local_storage(settings):
        base = settings.local_storage_base_url.rstrip("/")
        base_url = f"{base}{LOCAL_STORAGE_PREFIX}/{assets_bucket_name(settings)}"
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

    def __init__(self, bucket_name: str):
        from google.cloud import storage

        self._client = storage.Client()
        self._bucket = self._client.bucket(bucket_name)

    async def signed_upload_url(
        self,
        object_key: str,
        content_type: str,
        *,
        max_size_bytes: int | None = None,
        bucket_name: str | None = None,
        create_only: bool = False,
    ) -> str:
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


class LocalGcsClient:
    """GCS 계약을 로컬 디스크로 재현 — 서명 대신 /local-storage 라우트 URL을 발급한다.

    upload_required=True라서 프론트가 실제 PUT을 수행하고, 메타데이터 검증도
    실경로로 돈다. 인증·서명이 없으므로 로컬 개발 전용이다.
    """

    upload_required = True
    capability_mode = "local"

    def __init__(self, settings: Settings):
        self._root = local_storage_root(settings)
        base = settings.local_storage_base_url.rstrip("/")
        self._base_url = f"{base}{LOCAL_STORAGE_PREFIX}"
        self._default_bucket = LOCAL_UPLOADS_BUCKET

    def _url(self, bucket: str, object_key: str, query: dict[str, str] | None = None) -> str:
        url = f"{self._base_url}/{bucket}/{quote(object_key, safe='/')}"
        return f"{url}?{urlencode(query)}" if query else url

    def _path(self, object_key: str, bucket_name: str | None) -> Path:
        return local_object_path(self._root, bucket_name or self._default_bucket, object_key)

    async def signed_upload_url(
        self,
        object_key: str,
        content_type: str,
        *,
        max_size_bytes: int | None = None,
        bucket_name: str | None = None,
        create_only: bool = False,
    ) -> str:
        self._path(object_key, bucket_name)  # 키 검증 — 발급 시점에 이탈 거부
        query: dict[str, str] = {}
        if max_size_bytes is not None:
            query["max_size"] = str(max_size_bytes)
        if create_only:
            query["create_only"] = "1"
        return self._url(bucket_name or self._default_bucket, object_key, query)

    async def signed_read_url(self, object_key: str) -> str:
        return self._url(self._default_bucket, object_key)

    async def delete_object(self, object_key: str, *, bucket_name: str | None = None) -> bool:
        try:
            path = self._path(object_key, bucket_name)
        except ValueError:
            logger.warning("로컬 스토리지 삭제 거부(잘못된 키): %s", object_key)
            return False

        def _remove() -> bool:
            path.unlink(missing_ok=True)  # 이미 없음 = 삭제 목적 달성(멱등)
            Path(f"{path}{LOCAL_CTYPE_SUFFIX}").unlink(missing_ok=True)
            return True

        return await run_in_threadpool(_remove)

    async def object_metadata(
        self, object_key: str, *, bucket_name: str | None = None
    ) -> GcsObjectMetadata | None:
        try:
            path = self._path(object_key, bucket_name)
        except ValueError:
            return None

        def _load() -> GcsObjectMetadata | None:
            if not path.is_file():
                return None
            return GcsObjectMetadata(
                size_bytes=path.stat().st_size,
                content_type=local_object_content_type(path, object_key),
            )

        return await run_in_threadpool(_load)

    async def copy_from_bucket(
        self, source_bucket: str, source_key: str, destination_key: str
    ) -> bool:
        try:
            source = local_object_path(self._root, source_bucket, source_key)
            destination = self._path(destination_key, None)
        except ValueError:
            logger.warning(
                "로컬 스토리지 복사 거부(잘못된 키): %s/%s -> %s",
                source_bucket,
                source_key,
                destination_key,
            )
            return False

        def _copy() -> bool:
            if destination.is_file():
                return True  # create-only 의미 보존 — 기존 객체를 덮어쓰지 않음
            if not source.is_file():
                logger.error("로컬 스토리지 복사 원본 없음: %s/%s", source_bucket, source_key)
                return False
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            source_sidecar = Path(f"{source}{LOCAL_CTYPE_SUFFIX}")
            if source_sidecar.is_file():
                shutil.copyfile(source_sidecar, Path(f"{destination}{LOCAL_CTYPE_SUFFIX}"))
            return True

        return await run_in_threadpool(_copy)


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
    if settings.gcs_upload_bucket:
        return RealGcsClient(settings.gcs_upload_bucket)
    if settings.env in ("local", "test"):
        if settings.local_storage_dir:
            logger.warning(
                "GCS_UPLOAD_BUCKET 없음 — 로컬 스토리지(%s) 저장·서빙으로 동작",
                settings.local_storage_dir,
            )
            return LocalGcsClient(settings)
        logger.warning("GCS_UPLOAD_BUCKET 없음 — local/test DryRun GCS 클라이언트로 동작")
        return DryRunGcsClient()
    logger.error("GCS_UPLOAD_BUCKET 없음 — GCS capability unavailable")
    return UnavailableGcsClient()
