"""GCS SDK 경계 — 교차 버킷 복사의 멱등 조건."""

from unittest.mock import ANY

from api.integrations.gcs import RealGcsClient
from google.auth.credentials import Credentials, Signing
from google.cloud.exceptions import PreconditionFailed


class _FakeSigningCredentials(Credentials, Signing):
    @property
    def signer_email(self) -> str:
        return "local@example.test"

    @property
    def signer(self):
        return self

    def sign_bytes(self, message: bytes) -> bytes:
        return message

    def refresh(self, request) -> None:
        self.token = "local-token"


class _FakeComputeCredentials(Credentials):
    service_account_email = "api@example.test"

    def __init__(self):
        super().__init__()
        self.refresh_count = 0

    def refresh(self, request) -> None:
        self.refresh_count += 1
        self.token = "metadata-token"


class _FakeBlob:
    def __init__(self, name: str):
        self.name = name
        self.signed_url_calls: list[dict[str, object]] = []

    def generate_signed_url(self, **kwargs: object) -> str:
        self.signed_url_calls.append(kwargs)
        return "https://storage.example/signed"


class _FakeBucket:
    def __init__(self, name: str):
        self.name = name
        self.copy_error: Exception | None = None
        self.copies: list[tuple[str, str, str, dict[str, object]]] = []
        self.blobs: dict[str, _FakeBlob] = {}

    def blob(self, name: str) -> _FakeBlob:
        if name not in self.blobs:
            self.blobs[name] = _FakeBlob(name)
        return self.blobs[name]

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
        self._credentials = _FakeSigningCredentials()

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


async def test_signed_upload_url_signs_create_only_generation_precondition(monkeypatch):
    storage = _FakeStorageClient()
    monkeypatch.setattr("google.cloud.storage.Client", lambda: storage)
    gcs = RealGcsClient("private-uploads")

    url = await gcs.signed_upload_url(
        "products/staging/image.webp",
        "image/webp",
        max_size_bytes=10,
        bucket_name="public-assets",
        create_only=True,
    )

    assert url == "https://storage.example/signed"
    assert storage.bucket("public-assets").blob("products/staging/image.webp").signed_url_calls == [
        {
            "version": "v4",
            "expiration": ANY,
            "method": "PUT",
            "content_type": "image/webp",
            "headers": {
                "x-goog-content-length-range": "1,10",
                "x-goog-if-generation-match": "0",
            },
            "service_account_email": None,
            "access_token": None,
        }
    ]


async def test_signed_upload_url_uses_iam_signing_for_cloud_run_credentials(monkeypatch):
    storage = _FakeStorageClient()
    credentials = _FakeComputeCredentials()
    storage._credentials = credentials
    monkeypatch.setattr("google.cloud.storage.Client", lambda: storage)

    await RealGcsClient("private-uploads").signed_upload_url("image.png", "image/png")

    assert credentials.refresh_count == 1
    assert storage.bucket("private-uploads").blob("image.png").signed_url_calls == [
        {
            "version": "v4",
            "expiration": ANY,
            "method": "PUT",
            "content_type": "image/png",
            "headers": {},
            "service_account_email": "api@example.test",
            "access_token": "metadata-token",
        }
    ]


async def test_copy_from_bucket_reports_other_sdk_failures(monkeypatch):
    storage = _FakeStorageClient()
    monkeypatch.setattr("google.cloud.storage.Client", lambda: storage)
    gcs = RealGcsClient("private-uploads")
    storage.bucket("public-assets").copy_error = RuntimeError("unavailable")

    assert not await gcs.copy_from_bucket(
        "public-assets", "fabric/result.png", "uploads/custom_order/design-job.png"
    )
