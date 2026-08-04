"""Object store 선택 — 로컬 에뮬레이터 기본값과 배포 fail-fast 계약."""

import pytest
from worker.config import Settings
from worker.integrations import (
    LOCAL_ASSETS_BUCKET,
    LOCAL_GCS_EMULATOR_HOST,
    GcsObjectStore,
    build_object_store,
)


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


def test_build_object_store_uses_emulator_with_or_without_explicit_settings():
    explicit = build_object_store(
        _settings(gcs_bucket=LOCAL_ASSETS_BUCKET, gcs_emulator_host=LOCAL_GCS_EMULATOR_HOST)
    )
    default = build_object_store(_settings())
    for store in (explicit, default):
        assert isinstance(store, GcsObjectStore)
        bucket = store._bucket  # noqa: SLF001
        assert bucket.name == LOCAL_ASSETS_BUCKET
        connection = bucket.client._connection  # noqa: SLF001
        assert connection is not None
        assert connection.API_BASE_URL == LOCAL_GCS_EMULATOR_HOST


def test_emulator_host_is_rejected_outside_local():
    with pytest.raises(RuntimeError):
        build_object_store(
            _settings(
                env="staging",
                gcs_bucket="dev-assets",
                gcs_emulator_host="http://localhost:4443",
            )
        )
