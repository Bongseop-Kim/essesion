"""GCS SDK 경계 — 교차 버킷 복사의 멱등 조건."""

from api.integrations.gcs import RealGcsClient
from google.cloud.exceptions import PreconditionFailed


class _FakeBlob:
    def __init__(self, name: str):
        self.name = name


class _FakeBucket:
    def __init__(self, name: str):
        self.name = name
        self.copy_error: Exception | None = None
        self.copies: list[tuple[str, str, str, dict[str, object]]] = []

    def blob(self, name: str) -> _FakeBlob:
        return _FakeBlob(name)

    def copy_blob(
        self,
        blob: _FakeBlob,
        destination: "_FakeBucket",
        new_name: str,
        **kwargs: object,
    ) -> None:
        if self.copy_error is not None:
            raise self.copy_error
        self.copies.append((blob.name, destination.name, new_name, kwargs))


class _FakeStorageClient:
    def __init__(self):
        self.buckets: dict[str, _FakeBucket] = {}

    def bucket(self, name: str) -> _FakeBucket:
        return self.buckets.setdefault(name, _FakeBucket(name))


async def test_copy_from_bucket_is_create_only_and_existing_destination_is_success(monkeypatch):
    storage = _FakeStorageClient()
    monkeypatch.setattr("google.cloud.storage.Client", lambda: storage)
    gcs = RealGcsClient("private-uploads")

    assert await gcs.copy_from_bucket(
        "public-assets", "fabric/result.png", "uploads/custom_order/design-job.png"
    )
    assert storage.bucket("public-assets").copies == [
        (
            "fabric/result.png",
            "private-uploads",
            "uploads/custom_order/design-job.png",
            {"if_generation_match": 0},
        )
    ]

    storage.bucket("public-assets").copy_error = PreconditionFailed("already exists")
    assert await gcs.copy_from_bucket(
        "public-assets", "fabric/result.png", "uploads/custom_order/design-job.png"
    )


async def test_copy_from_bucket_reports_other_sdk_failures(monkeypatch):
    storage = _FakeStorageClient()
    monkeypatch.setattr("google.cloud.storage.Client", lambda: storage)
    gcs = RealGcsClient("private-uploads")
    storage.bucket("public-assets").copy_error = RuntimeError("unavailable")

    assert not await gcs.copy_from_bucket(
        "public-assets", "fabric/result.png", "uploads/custom_order/design-job.png"
    )
