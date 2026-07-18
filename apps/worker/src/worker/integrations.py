import hashlib
import logging
from pathlib import Path
from typing import Protocol

from google.api_core.exceptions import PreconditionFailed
from starlette.concurrency import run_in_threadpool

from worker.config import Settings

logger = logging.getLogger(__name__)

# api의 로컬 스토리지(<local_storage_dir>/<bucket>/<key>)와 같은 레이아웃·사이드카를 쓴다.
# api가 public_asset_url로 이 디렉터리를 /local-storage 라우트로 서빙한다.
LOCAL_CTYPE_SUFFIX = ".ctype"


class ObjectStore(Protocol):
    capability_mode: str

    async def upload_bytes(self, object_key: str, data: bytes, content_type: str) -> str: ...


class DryRunObjectStore:
    capability_mode = "dry_run"

    async def upload_bytes(self, object_key: str, data: bytes, content_type: str) -> str:
        logger.info("DRYRUN gcs upload: %s (%s, %d bytes)", object_key, content_type, len(data))
        return object_key


class LocalObjectStore:
    """GCS 없는 로컬에서 산출물을 디스크에 저장 — api의 /local-storage가 서빙한다."""

    capability_mode = "local"

    def __init__(self, root: Path, bucket: str):
        self._root = root.resolve()
        self._bucket = bucket

    async def upload_bytes(self, object_key: str, data: bytes, content_type: str) -> str:
        parts = object_key.split("/")
        if not object_key or any(part in ("", ".", "..") or "\\" in part for part in parts):
            raise ValueError(f"invalid object key: {object_key!r}")
        path = self._root.joinpath(self._bucket, *parts)
        if not path.resolve().is_relative_to(self._root):
            raise ValueError(f"object key escapes storage root: {object_key!r}")

        def _write() -> str:
            if path.is_file():
                # content-addressed 키 — 이미 있으면 같은 업로드가 완료된 것(GCS
                # if_generation_match=0과 동일한 멱등 의미)
                logger.info("local object already exists: %s", object_key)
                return object_key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            Path(f"{path}{LOCAL_CTYPE_SUFFIX}").write_text(content_type)
            return object_key

        return await run_in_threadpool(_write)


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
    if settings.local_storage_dir:
        logger.warning(
            "GCS_BUCKET 없음 — 로컬 스토리지(%s/%s)에 저장",
            settings.local_storage_dir,
            settings.local_assets_bucket,
        )
        return LocalObjectStore(Path(settings.local_storage_dir), settings.local_assets_bucket)
    logger.warning("GCS_BUCKET 없음 — DryRun object store로 동작")
    return DryRunObjectStore()


def content_key(prefix: str, data: bytes, suffix: str) -> str:
    return f"{prefix}/{hashlib.sha256(data).hexdigest()[:16]}.{suffix}"
