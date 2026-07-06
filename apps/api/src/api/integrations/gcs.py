"""GCS — 서명 업로드 URL 발급(ImageKit 대체) + 객체 삭제(정리 배치).

서명은 로컬 키 연산(네트워크 불필요), 삭제는 blocking IO라 threadpool로.
버킷 미설정 시 DryRun: 가짜 URL 반환(로컬 개발용).
"""

import logging
from datetime import timedelta
from typing import Protocol

from starlette.concurrency import run_in_threadpool

from api.config import Settings

logger = logging.getLogger(__name__)

UPLOAD_URL_TTL = timedelta(minutes=15)


class GcsClient(Protocol):
    async def signed_upload_url(self, object_key: str, content_type: str) -> str: ...

    async def delete_object(self, object_key: str) -> bool: ...


class RealGcsClient:
    def __init__(self, bucket_name: str):
        from google.cloud import storage

        self._bucket = storage.Client().bucket(bucket_name)

    async def signed_upload_url(self, object_key: str, content_type: str) -> str:
        blob = self._bucket.blob(object_key)
        return await run_in_threadpool(
            blob.generate_signed_url,
            version="v4",
            expiration=UPLOAD_URL_TTL,
            method="PUT",
            content_type=content_type,
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


class DryRunGcsClient:
    def __init__(self) -> None:
        self.deleted: list[str] = []

    async def signed_upload_url(self, object_key: str, content_type: str) -> str:
        logger.info("DRYRUN gcs signed url: %s (%s)", object_key, content_type)
        return f"https://storage.googleapis.example/dry-run/{object_key}"

    async def delete_object(self, object_key: str) -> bool:
        logger.info("DRYRUN gcs delete: %s", object_key)
        self.deleted.append(object_key)
        return True


def build_gcs_client(settings: Settings) -> GcsClient:
    if settings.gcs_bucket:
        return RealGcsClient(settings.gcs_bucket)
    logger.warning("GCS_BUCKET 없음 — DryRun GCS 클라이언트로 동작")
    return DryRunGcsClient()
