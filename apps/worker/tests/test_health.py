from fastapi.testclient import TestClient
from worker.main import app


def test_healthz():
    res = TestClient(app).get("/healthz")
    assert res.status_code == 200
    assert "x-request-id" in res.headers
