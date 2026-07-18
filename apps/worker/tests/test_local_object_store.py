"""LocalObjectStore — GCS 없는 로컬에서 산출물을 디스크에 저장하는 계약."""

import pytest
from worker.config import Settings
from worker.integrations import (
    DryRunObjectStore,
    LocalObjectStore,
    build_object_store,
)


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


def test_build_object_store_selects_local_then_dry_run(tmp_path):
    local = build_object_store(_settings(local_storage_dir=str(tmp_path)))
    assert isinstance(local, LocalObjectStore)
    assert local.capability_mode == "local"
    assert isinstance(build_object_store(_settings(local_storage_dir="")), DryRunObjectStore)


async def test_upload_bytes_writes_file_with_content_type(tmp_path):
    store = LocalObjectStore(tmp_path, "dry-run-assets")

    key = await store.upload_bytes("fabric/abc.png", b"png-bytes", "image/png")

    assert key == "fabric/abc.png"
    path = tmp_path / "dry-run-assets" / "fabric" / "abc.png"
    assert path.read_bytes() == b"png-bytes"
    assert (tmp_path / "dry-run-assets" / "fabric" / "abc.png.ctype").read_text() == "image/png"


async def test_upload_bytes_is_idempotent_for_existing_key(tmp_path):
    store = LocalObjectStore(tmp_path, "dry-run-assets")
    await store.upload_bytes("fabric/abc.png", b"first", "image/png")

    # content-addressed 키 — 기존 객체는 덮어쓰지 않는다 (GCS if_generation_match=0 의미)
    await store.upload_bytes("fabric/abc.png", b"second", "image/png")

    assert (tmp_path / "dry-run-assets" / "fabric" / "abc.png").read_bytes() == b"first"


async def test_upload_bytes_rejects_path_traversal(tmp_path):
    store = LocalObjectStore(tmp_path, "dry-run-assets")
    with pytest.raises(ValueError):
        await store.upload_bytes("../escape.png", b"x", "image/png")
    with pytest.raises(ValueError):
        await store.upload_bytes("fabric//abc.png", b"x", "image/png")
