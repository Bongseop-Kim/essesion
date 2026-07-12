import asyncio

import pytest
from api.config import Settings
from api.domains.auth.rate_limit import AuthRateLimiter
from api.errors import RateLimitedError, ServiceUnavailableError
from api.integrations.gcs import (
    UnavailableGcsClient,
    assets_capability_mode,
    build_gcs_client,
)
from api.integrations.solapi import UnavailableSolapiClient, build_solapi_client
from api.integrations.toss import UnavailableTossClient, build_toss_client
from api.main import create_app
from fastapi.testclient import TestClient
from obs import request_id_var
from pydantic_settings import SettingsConfigDict


class _TestSettings(Settings):
    model_config = SettingsConfigDict(env_file=None)


def test_auth_rate_limiter_expires_and_bounds_keys():
    limiter = AuthRateLimiter(attempts=1, window_seconds=10, max_keys=2)
    limiter.check("a", now=0)
    limiter.check("b", now=0)
    limiter.check("c", now=0)  # 가장 오래된 a를 제거
    limiter.check("a", now=1)
    with pytest.raises(RateLimitedError):
        limiter.check("a", now=2)
    limiter.check("a", now=11)


def test_request_id_context_security_headers_and_unhandled_error():
    application = create_app(_TestSettings())
    seen_request_ids: list[str] = []

    @application.get("/_test/request-context")
    def request_context() -> dict[str, str]:
        seen_request_ids.append(request_id_var.get())
        return {"status": "ok"}

    @application.get("/_test/unhandled")
    def unhandled() -> None:
        raise RuntimeError("test error")

    with TestClient(application, raise_server_exceptions=False) as client:
        success = client.get("/_test/request-context", headers={"X-Request-ID": "hardening-rid"})
        failed = client.get("/_test/unhandled", headers={"X-Request-ID": "error-rid"})

    assert success.headers["x-request-id"] == "hardening-rid"
    assert seen_request_ids == ["hardening-rid"]
    assert success.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in success.headers["content-security-policy"]
    assert success.headers["x-content-type-options"] == "nosniff"
    assert failed.status_code == 500
    assert failed.json()["code"] == "internal_error"
    assert failed.headers["x-request-id"] == "error-rid"
    assert "frame-ancestors 'none'" in failed.headers["content-security-policy"]


def test_nonlocal_missing_toss_and_gcs_are_unavailable_and_not_ready():
    settings = _TestSettings(env="staging", toss_secret_key="", gcs_upload_bucket="")
    toss = build_toss_client(settings)
    gcs = build_gcs_client(settings)
    solapi = build_solapi_client(settings)
    assert isinstance(toss, UnavailableTossClient)
    assert isinstance(gcs, UnavailableGcsClient)
    assert isinstance(solapi, UnavailableSolapiClient)

    with pytest.raises(ServiceUnavailableError) as toss_error:
        asyncio.run(toss.confirm("payment-key", "order-id", 1000))
    assert toss_error.value.code == "toss_unavailable"
    with pytest.raises(ServiceUnavailableError) as gcs_error:
        asyncio.run(gcs.signed_read_url("private/object"))
    assert gcs_error.value.code == "gcs_unavailable"
    assert asyncio.run(solapi.send_sms("01000000000", "test")) is False

    application = create_app(settings)
    with TestClient(application) as client:
        ready = client.get("/readyz", headers={"X-Request-ID": "ready-rid"})
    assert ready.status_code == 503
    assert ready.json() == {
        "status": "not_ready",
        "capabilities": {
            "toss": "unavailable",
            "gcs": "unavailable",
            "gcs_assets": "unavailable",
            "solapi": "unavailable",
            "admin_edge_proxy": "unavailable",
        },
    }
    assert ready.headers["x-request-id"] == "ready-rid"


def test_local_missing_toss_and_gcs_remain_dry_run_ready():
    application = create_app(_TestSettings(env="local", toss_secret_key="", gcs_upload_bucket=""))
    with TestClient(application) as client:
        ready = client.get("/readyz")
    assert ready.status_code == 200
    assert ready.json()["capabilities"] == {
        "toss": "dry_run",
        "gcs": "dry_run",
        "gcs_assets": "dry_run",
        "solapi": "dry_run",
        "admin_edge_proxy": "bypassed",
    }


def test_local_real_private_gcs_without_assets_bucket_is_not_ready():
    settings = _TestSettings(
        env="local",
        gcs_upload_bucket="private-uploads",
        gcs_assets_bucket="",
    )
    assert assets_capability_mode(settings) == "unavailable"


def test_nonlocal_admin_paths_require_trusted_edge_header():
    settings = _TestSettings(
        env="staging",
        edge_proxy_secret="edge-test-secret",
    )
    application = create_app(settings)

    @application.get("/admin/_test/edge")
    def admin_edge_test() -> dict[str, str]:
        return {"status": "ok"}

    origin = {"Origin": settings.admin_frontend_origin}
    with TestClient(application) as client:
        missing = client.get("/admin/_test/edge", headers=origin)
        spoofed = client.get(
            "/admin/_test/edge",
            headers={**origin, "X-Essesion-Edge-Secret": "caller-value"},
        )
        accepted = client.get(
            "/admin/_test/edge",
            headers={**origin, "X-Essesion-Edge-Secret": "edge-test-secret"},
        )

    assert missing.status_code == 403
    assert spoofed.status_code == 403
    assert accepted.status_code == 200
    assert accepted.headers["cache-control"] == "no-store"
