from fastapi.testclient import TestClient
from worker.config import Settings
from worker.main import app, create_app


def test_healthz():
    res = TestClient(app).get("/healthz")
    assert res.status_code == 200
    assert "x-request-id" in res.headers


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
