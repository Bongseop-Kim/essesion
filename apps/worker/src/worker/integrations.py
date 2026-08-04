import logging
from typing import Protocol

from google.api_core.exceptions import PreconditionFailed
from starlette.concurrency import run_in_threadpool

from worker.config import Settings
from worker.engine.determinism import stable_digest

logger = logging.getLogger(__name__)
# api(api/integrations/gcs.py)·docker-compose.yml과 같은 값이어야 한다 — 포트를 바꾸면 세 곳 모두.
LOCAL_GCS_EMULATOR_HOST = "http://localhost:4443"
LOCAL_ASSETS_BUCKET = "dev-assets"


class ObjectStore(Protocol):
    async def upload_bytes(self, object_key: str, data: bytes, content_type: str) -> str: ...


class GcsObjectStore:
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
    if settings.env in ("local", "test"):
        # local/test는 항상 에뮬레이터를 경유한다.
        return GcsObjectStore(
            settings.gcs_bucket or LOCAL_ASSETS_BUCKET,
            settings.gcs_emulator_host or LOCAL_GCS_EMULATOR_HOST,
        )
    if not settings.gcs_bucket:
        raise RuntimeError("GCS_BUCKET is required outside local/test")
    return GcsObjectStore(settings.gcs_bucket)


def content_key(prefix: str, data: bytes, suffix: str) -> str:
    return f"{prefix}/{stable_digest(data, 16)}.{suffix}"
