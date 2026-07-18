import asyncio
import uuid

import pytest
from api.config import Settings
from api.domains.auth.rate_limit import (
    AuthRateLimiter,
    RecentKeyCache,
    request_client_ip,
)
from api.errors import RateLimitedError, ServiceUnavailableError
from api.integrations.gcs import (
    UnavailableGcsClient,
    assets_capability_mode,
    build_gcs_client,
)
from api.integrations.solapi import UnavailableSolapiClient, build_solapi_client
from api.integrations.tasks import UnavailableTaskQueue, build_task_queue
from api.integrations.toss import UnavailableTossClient, build_toss_client
from api.main import create_app
from fastapi import Request
from fastapi.testclient import TestClient
from obs import request_id_var
from pydantic_settings import SettingsConfigDict


class _TestSettings(Settings):
    model_config = SettingsConfigDict(env_file=None)
    public_api_origin: str = "https://api.essesion.shop"


def test_auth_rate_limiter_expires_and_bounds_keys():
    limiter = AuthRateLimiter(attempts=1, window_seconds=10, max_keys=2)
    limiter.check("a", now=0)
    limiter.check("b", now=0)
    limiter.check("c", now=0)  # 가장 오래된 a를 제거
    limiter.check("a", now=1)
    with pytest.raises(RateLimitedError):
        limiter.check("a", now=2)
    limiter.check("a", now=11)


def test_recent_key_cache_expires_and_bounds_keys():
    cache = RecentKeyCache(ttl_seconds=10, max_keys=2)
    cache.add("a", now=0)
    cache.add("b", now=1)
    cache.add("c", now=2)

    assert not {"a", "b", "c"} & cache._expires.keys()
    assert cache.contains("a", now=3) is False
    assert cache.contains("b", now=3) is True
    assert cache.contains("c", now=3) is True
    assert cache.contains("b", now=11) is False
    assert cache.contains("c", now=11) is True


def test_client_ip_trusts_only_authenticated_cloudflare_header():
    application = create_app(_TestSettings(env="staging", edge_proxy_secret="edge-test-secret"))

    @application.get("/_test/client-ip")
    def client_ip(request: Request) -> dict[str, str | None]:
        return {
            "connected": request.client.host if request.client is not None else None,
            "resolved": request_client_ip(request),
        }

    with TestClient(application, base_url="https://testserver") as client:
        missing = client.get(
            "/_test/client-ip",
            headers={"CF-Connecting-IP": "203.0.113.10"},
        )
        wrong_secret = client.get(
            "/_test/client-ip",
            headers={
                "CF-Connecting-IP": "203.0.113.10",
                "X-Essesion-Edge-Secret": "caller-value",
            },
        )
        trusted = client.get(
            "/_test/client-ip",
            headers={
                "CF-Connecting-IP": "203.0.113.10",
                "X-Essesion-Edge-Secret": "edge-test-secret",
            },
        ).json()
        invalid_ip = client.get(
            "/_test/client-ip",
            headers={
                "CF-Connecting-IP": "not-an-ip",
                "X-Essesion-Edge-Secret": "edge-test-secret",
            },
        ).json()

    assert missing.status_code == 403
    assert wrong_secret.status_code == 403
    assert trusted["resolved"] == "203.0.113.10"
    assert invalid_ip["resolved"] == invalid_ip["connected"]


def test_nonlocal_session_cookie_is_secure():
    application = create_app(_TestSettings(env="staging", edge_proxy_secret="edge-test-secret"))

    @application.get("/_test/session")
    def set_session(request: Request) -> dict[str, str]:
        request.session["oauth_state"] = "state"
        return {"status": "ok"}

    with TestClient(application, base_url="https://testserver") as client:
        response = client.get(
            "/_test/session",
            headers={"X-Essesion-Edge-Secret": "edge-test-secret"},
        )

    assert response.status_code == 200
    assert "secure" in response.headers["set-cookie"].lower()


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
    settings = _TestSettings(
        env="staging",
        database_url="postgresql+asyncpg://essesion:essesion@127.0.0.1:1/essesion",
        edge_proxy_secret="edge-test-secret",
        toss_secret_key="",
        gcs_upload_bucket="",
    )
    toss = build_toss_client(settings)
    gcs = build_gcs_client(settings)
    solapi = build_solapi_client(settings)
    tasks = build_task_queue(settings)
    assert isinstance(toss, UnavailableTossClient)
    assert isinstance(gcs, UnavailableGcsClient)
    assert isinstance(solapi, UnavailableSolapiClient)
    assert isinstance(tasks, UnavailableTaskQueue)

    with pytest.raises(ServiceUnavailableError) as toss_error:
        asyncio.run(toss.confirm("payment-key", "order-id", 1000))
    assert toss_error.value.code == "toss_unavailable"
    with pytest.raises(ServiceUnavailableError) as gcs_error:
        asyncio.run(gcs.signed_read_url("private/object"))
    assert gcs_error.value.code == "gcs_unavailable"
    with pytest.raises(ServiceUnavailableError) as tasks_error:
        asyncio.run(tasks.enqueue_finalize(uuid.uuid4()))
    assert tasks_error.value.code == "finalize_tasks_unavailable"
    assert asyncio.run(solapi.send_sms("01000000000", "test")) is False

    application = create_app(settings)
    with TestClient(application) as client:
        direct_ready = client.get("/readyz")
        ready = client.get(
            "/readyz",
            headers={
                "X-Request-ID": "ready-rid",
                "X-Essesion-Edge-Secret": "edge-test-secret",
            },
        )
        health = client.get("/healthz")
        batch = client.post("/batch/cancel-stale-orders")
        ordinary = client.post("/auth/login", json={})
    assert ready.status_code == 503
    assert direct_ready.status_code == 403
    assert ready.json() == {
        "status": "not_ready",
        "capabilities": {
            "toss": "unavailable",
            "gcs": "unavailable",
            "gcs_assets": "unavailable",
            "solapi": "unavailable",
            "worker": "unavailable",
            "finalize_tasks": "unavailable",
            "batch_auth": "unavailable",
            "oauth_google": "unavailable",
            "oauth_kakao": "unavailable",
            "oauth_naver": "unavailable",
            "oauth_apple": "unavailable",
            "auth_secrets": "unavailable",
            "edge_proxy": "ready",
            "database": "unavailable",
        },
    }
    assert ready.headers["x-request-id"] == "ready-rid"
    assert health.status_code == 200
    assert batch.status_code == 503
    assert ordinary.status_code == 403


def test_local_missing_toss_and_gcs_remain_dry_run_ready():
    # local_storage_dir 기본값이 있으므로 GCS 미설정 local은 로컬 디스크 저장·서빙 모드
    application = create_app(_TestSettings(env="local", toss_secret_key="", gcs_upload_bucket=""))
    with TestClient(application) as client:
        ready = client.get("/readyz")
    assert ready.status_code == 200
    assert ready.json()["capabilities"] == {
        "toss": "dry_run",
        "gcs": "local",
        "gcs_assets": "local",
        "solapi": "dry_run",
        "worker": "local",
        "finalize_tasks": "dry_run",
        "batch_auth": "shared_secret",
        "oauth_google": "optional",
        "oauth_kakao": "optional",
        "oauth_naver": "optional",
        "oauth_apple": "optional",
        "auth_secrets": "bypassed",
        "edge_proxy": "bypassed",
        "database": "bypassed",
    }


def test_local_real_private_gcs_without_assets_bucket_is_not_ready():
    settings = _TestSettings(
        env="local",
        gcs_upload_bucket="private-uploads",
        gcs_assets_bucket="",
    )
    assert assets_capability_mode(settings) == "unavailable"


def test_nonlocal_ordinary_http_requires_exact_trusted_edge_header():
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
        direct_store_login = client.post("/auth/login", json={})
        direct_toss_webhook = client.post("/payments/webhook", json={})
        health_subpath = client.get("/healthz/extra")
        ready_subpath = client.get("/readyz/extra")
        bare_batch = client.get("/batch")
        batch_prefix_collision = client.get("/batchish")
        missing = client.get("/admin/_test/edge", headers=origin)
        wrong = client.get(
            "/admin/_test/edge",
            headers={**origin, "X-Essesion-Edge-Secret": "caller-value"},
        )
        duplicate = client.get(
            "/admin/_test/edge",
            headers=[
                ("Origin", settings.admin_frontend_origin),
                ("X-Essesion-Edge-Secret", "edge-test-secret"),
                ("X-Essesion-Edge-Secret", "edge-test-secret"),
            ],
        )
        accepted = client.get(
            "/admin/_test/edge",
            headers={**origin, "X-Essesion-Edge-Secret": "edge-test-secret"},
        )
        store_login_via_edge = client.post(
            "/auth/login",
            json={},
            headers={"X-Essesion-Edge-Secret": "edge-test-secret"},
        )
        toss_webhook_via_edge = client.post(
            "/payments/webhook",
            json={},
            headers={"X-Essesion-Edge-Secret": "edge-test-secret"},
        )

    assert direct_store_login.status_code == 403
    assert direct_toss_webhook.status_code == 403
    assert health_subpath.status_code == 403
    assert ready_subpath.status_code == 403
    assert bare_batch.status_code == 403
    assert batch_prefix_collision.status_code == 403
    assert missing.status_code == 403
    assert wrong.status_code == 403
    assert duplicate.status_code == 403
    assert accepted.status_code == 200
    assert accepted.headers["cache-control"] == "no-store"
    assert store_login_via_edge.status_code == 422
    assert toss_webhook_via_edge.status_code == 200
