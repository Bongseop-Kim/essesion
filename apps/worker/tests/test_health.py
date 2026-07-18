import pytest
from fastapi.testclient import TestClient
from worker.config import Settings
from worker.main import app, create_app


def test_healthz():
    res = TestClient(app).get("/healthz")
    assert res.status_code == 200
    assert "x-request-id" in res.headers


def test_local_readyz_bypasses_external_database_and_uses_local_store():
    # local_storage_dir 기본값이 있으므로 GCS 미설정 local은 로컬 디스크 저장 모드
    application = create_app(Settings(_env_file=None))  # type: ignore[call-arg]
    with TestClient(application) as client:
        response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "capabilities": {"database": "bypassed", "gcs_assets": "local"},
    }


def test_nonlocal_worker_refuses_to_start_without_gcs_bucket():
    application = create_app(
        Settings(_env_file=None, env="staging", gcs_bucket="")  # type: ignore[call-arg]
    )

    with pytest.raises(RuntimeError, match="GCS_BUCKET"):
        with TestClient(application):
            pass


def _paths(mode: str) -> set[str]:
    settings = Settings(_env_file=None, service_mode=mode)  # type: ignore[call-arg]
    paths: set[str] = set()

    def collect(routes) -> None:
        for route in routes:
            if hasattr(route, "path"):
                paths.add(route.path)
            elif included := getattr(route, "original_router", None):
                collect(included.routes)

    collect(create_app(settings).routes)
    return paths


def test_generate_mode_excludes_finalize_task_routes():
    paths = _paths("generate")
    assert {"/generate", "/motifs/candidates", "/motifs/generate"} <= paths
    assert not ({"/export", "/tasks/finalize"} & paths)


def test_finalize_mode_only_exposes_finalize_task_routes():
    paths = _paths("finalize")
    assert {"/export", "/tasks/finalize"} <= paths
    assert not ({"/generate", "/motifs/candidates", "/motifs/generate"} & paths)


def test_all_mode_keeps_local_compatibility():
    paths = _paths("all")
    assert {"/generate", "/export", "/tasks/finalize"} <= paths
