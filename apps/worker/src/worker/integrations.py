import logging
from typing import Protocol

from google.api_core.exceptions import PreconditionFailed
from starlette.concurrency import run_in_threadpool

from worker.config import Settings
from worker.engine.determinism import stable_digest

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

    def __init__(self, bucket_name: str, emulator_host: str = ""):
        from google.cloud import storage

        if emulator_host:
            from google.auth.credentials import AnonymousCredentials

            client = storage.Client(
                project="local",
                credentials=AnonymousCredentials(),
                client_options={"api_endpoint": emulator_host.rstrip("/")},
            )
        else:
            client = storage.Client()
        self._bucket = client.bucket(bucket_name)

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
    if settings.gcs_emulator_host and settings.env not in ("local", "test"):
        # 서명·인가가 없는 에뮬레이터 경로가 배포 환경에 섞이지 않도록 fail-closed
        raise RuntimeError("GCS_EMULATOR_HOST is local/test only")
    if settings.gcs_bucket:
        return GcsObjectStore(settings.gcs_bucket, emulator_host=settings.gcs_emulator_host)
    if settings.env not in ("local", "test"):
        raise RuntimeError("GCS_BUCKET is required outside local/test")
    logger.warning("GCS_BUCKET 없음 — DryRun object store로 동작")
    return DryRunObjectStore()


def content_key(prefix: str, data: bytes, suffix: str) -> str:
    return f"{prefix}/{stable_digest(data, 16)}.{suffix}"
