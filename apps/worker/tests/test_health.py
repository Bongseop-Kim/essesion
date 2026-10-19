import pytest
from fastapi.testclient import TestClient
from worker.config import Settings
from worker.main import app, create_app


def test_healthz():
    res = TestClient(app).get("/healthz")
    assert res.status_code == 200
    assert "x-request-id" in res.headers


def test_local_readyz_bypasses_database_and_uses_emulator_store():
    application = create_app(Settings(_env_file=None))  # type: ignore[call-arg]
    with TestClient(application) as client:
        response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "capabilities": {"database": "bypassed"},
    }


def test_nonlocal_worker_refuses_to_start_without_gcs_bucket():
    application = create_app(
        Settings(_env_file=None, env="staging", gcs_bucket="")  # type: ignore[call-arg]
    )

    with pytest.raises(RuntimeError, match="GCS_BUCKET"):
        with TestClient(application):
            pass
