from typing import Any, cast

import pytest
from google.api_core.exceptions import PreconditionFailed
from worker.integrations import GcsObjectStore, content_key


class _Blob:
    def __init__(self, error: Exception | None = None):
        self.error = error
        self.calls: list[tuple[bytes, dict[str, Any]]] = []

    def upload_from_string(self, data: bytes, **kwargs: Any) -> None:
        self.calls.append((data, kwargs))
        if self.error is not None:
            raise self.error


class _Bucket:
    def __init__(self, blob: _Blob):
        self._blob = blob
        self.keys: list[str] = []

    def blob(self, object_key: str) -> _Blob:
        self.keys.append(object_key)
        return self._blob


def _store(blob: _Blob) -> tuple[GcsObjectStore, _Bucket]:
    store = GcsObjectStore.__new__(GcsObjectStore)
    bucket = _Bucket(blob)
    cast(Any, store)._bucket = bucket
    return store, bucket


async def test_gcs_upload_is_create_only() -> None:
    blob = _Blob()
    store, bucket = _store(blob)

    result = await store.upload_bytes("fabric/digest.png", b"png", "image/png")

    assert result == "fabric/digest.png"
    assert bucket.keys == ["fabric/digest.png"]
    assert blob.calls == [
        (
            b"png",
            {"content_type": "image/png", "if_generation_match": 0},
        )
    ]


async def test_gcs_upload_treats_existing_deterministic_key_as_success() -> None:
    blob = _Blob(PreconditionFailed("object already exists"))
    store, _ = _store(blob)

    result = await store.upload_bytes("previews/request/candidate.png", b"png", "image/png")

    assert result == "previews/request/candidate.png"
    assert blob.calls[0][1]["if_generation_match"] == 0


async def test_gcs_upload_does_not_hide_other_failures() -> None:
    store, _ = _store(_Blob(RuntimeError("storage unavailable")))

    with pytest.raises(RuntimeError, match="storage unavailable"):
        await store.upload_bytes("fabric/digest.png", b"png", "image/png")


def test_content_key_distinguishes_different_bytes_under_reused_prefix() -> None:
    first = content_key("previews/reused-request/candidate", b"first", "png")
    second = content_key("previews/reused-request/candidate", b"second", "png")

    assert first != second
    assert first.startswith("previews/reused-request/candidate/")
    assert first.endswith(".png")
