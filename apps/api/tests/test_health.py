from api.main import app
from fastapi.testclient import TestClient


def test_healthz_and_request_id_propagation():
    client = TestClient(app)
    res = client.get("/healthz", headers={"x-request-id": "rid-123"})
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert res.headers["x-request-id"] == "rid-123"  # 수신 ID 승계


def test_request_id_issued_when_absent():
    res = TestClient(app).get("/healthz")
    assert len(res.headers["x-request-id"]) == 32  # uuid4().hex
