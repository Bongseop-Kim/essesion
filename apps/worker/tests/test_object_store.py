"""Object store 선택 — 로컬 에뮬레이터 기본값과 배포 fail-fast 계약."""

import pytest
from worker.config import Settings
from worker.integrations import GcsObjectStore, build_object_store


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


def test_build_object_store_uses_emulator_with_or_without_explicit_settings():
    store = build_object_store(
        _settings(gcs_bucket="dev-assets", gcs_emulator_host="http://localhost:4443")
    )
    assert isinstance(store, GcsObjectStore)
    assert isinstance(build_object_store(_settings()), GcsObjectStore)


def test_emulator_host_is_rejected_outside_local():
    with pytest.raises(RuntimeError):
        build_object_store(
            _settings(
                env="staging",
                gcs_bucket="dev-assets",
                gcs_emulator_host="http://localhost:4443",
            )
        )
