"""GCS — 비공개 업로드 버킷의 서명 URL 발급(ImageKit 대체) + 객체 삭제(정리 배치).

업로드는 공개 assets 버킷과 분리된 비공개 버킷 — 읽기도 서명 URL 경유(ARCHITECTURE §6).
서명은 IAM signBlob(네트워크), 삭제는 blocking IO라 threadpool로.
버킷 미설정 시 DryRun: 가짜 URL 반환(로컬 개발용).
"""

import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Protocol

from starlette.concurrency import run_in_threadpool

from api.config import Settings

logger = logging.getLogger(__name__)

UPLOAD_URL_TTL = timedelta(minutes=15)
READ_URL_TTL = timedelta(minutes=15)


@dataclass(frozen=True)
class GcsObjectMetadata:
    size_bytes: int
    content_type: str | None


class GcsClient(Protocol):
    upload_required: bool

    async def signed_upload_url(
        self,
        object_key: str,
        content_type: str,
        *,
        max_size_bytes: int | None = None,
    ) -> str: ...

    async def signed_read_url(self, object_key: str) -> str: ...

    async def delete_object(self, object_key: str) -> bool: ...

    async def object_metadata(self, object_key: str) -> GcsObjectMetadata | None: ...

    async def copy_from_bucket(
        self, source_bucket: str, source_key: str, destination_key: str
    ) -> bool: ...


class RealGcsClient:
    upload_required = True

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
    ) -> str:
        blob = self._bucket.blob(object_key)
        headers = (
            {"x-goog-content-length-range": f"1,{max_size_bytes}"}
            if max_size_bytes is not None
            else {}
        )
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

    async def delete_object(self, object_key: str) -> bool:
        from google.cloud.exceptions import NotFound

        def _delete() -> bool:
            try:
                self._bucket.blob(object_key).delete()
            except NotFound:
                pass  # 이미 없음 = 삭제 목적 달성(멱등)
            return True

        try:
            return await run_in_threadpool(_delete)
        except Exception:
            logger.exception("GCS 삭제 실패: %s", object_key)
            return False

    async def object_metadata(self, object_key: str) -> GcsObjectMetadata | None:
        from google.cloud.exceptions import NotFound

        def _load() -> GcsObjectMetadata | None:
            blob = self._bucket.blob(object_key)
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

    def __init__(self) -> None:
        self.deleted: list[str] = []
        self.copied: list[tuple[str, str, str]] = []

    async def signed_upload_url(
        self,
        object_key: str,
        content_type: str,
        *,
        max_size_bytes: int | None = None,
    ) -> str:
        logger.info("DRYRUN gcs signed url: %s (%s)", object_key, content_type)
        return f"https://storage.googleapis.example/dry-run/{object_key}"

    async def signed_read_url(self, object_key: str) -> str:
        logger.info("DRYRUN gcs read url: %s", object_key)
        return f"https://storage.googleapis.example/dry-run/{object_key}"

    async def delete_object(self, object_key: str) -> bool:
        logger.info("DRYRUN gcs delete: %s", object_key)
        self.deleted.append(object_key)
        return True

    async def object_metadata(self, object_key: str) -> GcsObjectMetadata | None:
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


def build_gcs_client(settings: Settings) -> GcsClient:
    if settings.gcs_upload_bucket:
        return RealGcsClient(settings.gcs_upload_bucket)
    logger.warning("GCS_UPLOAD_BUCKET 없음 — DryRun GCS 클라이언트로 동작")
    return DryRunGcsClient()
