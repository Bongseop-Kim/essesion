"""object store 선택 — 에뮬레이터(fake-gcs-server)·DryRun·fail-closed 계약."""

import pytest
from worker.config import Settings
from worker.integrations import DryRunObjectStore, GcsObjectStore, build_object_store


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


def test_build_object_store_selects_emulator_backed_gcs_then_dry_run():
    store = build_object_store(
        _settings(gcs_bucket="dev-assets", gcs_emulator_host="http://localhost:4443")
    )
    assert isinstance(store, GcsObjectStore)
    assert store.capability_mode == "real"
    assert isinstance(build_object_store(_settings()), DryRunObjectStore)


def test_emulator_host_is_rejected_outside_local():
    with pytest.raises(RuntimeError):
        build_object_store(
            _settings(
                env="staging",
                gcs_bucket="dev-assets",
                gcs_emulator_host="http://localhost:4443",
            )
        )
