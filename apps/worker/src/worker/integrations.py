import hashlib
import logging
from typing import Protocol

from google.api_core.exceptions import PreconditionFailed
from starlette.concurrency import run_in_threadpool

from worker.config import Settings

logger = logging.getLogger(__name__)


class ObjectStore(Protocol):
    capability_mode: str

    async def upload_bytes(self, object_key: str, data: bytes, content_type: str) -> str: ...


class DryRunObjectStore:
    capability_mode = "dry_run"

    async def upload_bytes(self, object_key: str, data: bytes, content_type: str) -> str:
        logger.info("DRYRUN gcs upload: %s (%s, %d bytes)", object_key, content_type, len(data))
        return object_key


class GcsObjectStore:
    capability_mode = "real"

    def __init__(self, bucket_name: str):
        from google.cloud import storage

        self._bucket = storage.Client().bucket(bucket_name)

    async def upload_bytes(self, object_key: str, data: bytes, content_type: str) -> str:
        def _upload() -> str:
            blob = self._bucket.blob(object_key)
            try:
                # Worker IAM is objectCreator-only. A generation precondition prevents
                # retries from overwriting an existing deterministic object key.
                blob.upload_from_string(
                    data,
                    content_type=content_type,
                    if_generation_match=0,
                )
            except PreconditionFailed:
                # Object keys are content-addressed and deterministic, so an existing
                # object means a prior attempt already completed the same upload.
                logger.info("GCS object already exists: %s", object_key)
            return object_key

        return await run_in_threadpool(_upload)


def build_object_store(settings: Settings) -> ObjectStore:
    if settings.gcs_bucket:
        return GcsObjectStore(settings.gcs_bucket)
    if settings.env not in ("local", "test"):
        raise RuntimeError("GCS_BUCKET is required outside local/test")
    logger.warning("GCS_BUCKET 없음 — DryRun object store로 동작")
    return DryRunObjectStore()


def content_key(prefix: str, data: bytes, suffix: str) -> str:
    return f"{prefix}/{hashlib.sha256(data).hexdigest()[:16]}.{suffix}"
