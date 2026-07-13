"""배치 — 자동확정 7일 / stale 취소 30분 (money.md §7)."""

from datetime import UTC, datetime, timedelta

import pytest
from api.domains.batch.router import ACTIVE_GENERATION_JOB_LEASE
from db.models.commerce import Claim, Order, OrderItem
from db.models.design import (
    FINALIZE_STALE_MESSAGE,
    FINALIZE_TEMPORARY_FAILURE_MARKER,
    DesignSession,
    GenerationJob,
)
from sqlalchemy import func, select

from .factories import make_coupon, make_order, make_user, make_user_coupon

BATCH_HEADERS = {"Authorization": "Bearer test-batch-token"}


async def test_batch_requires_token(client):
    assert (await client.post("/batch/auto-confirm-orders")).status_code == 401
    bad = {"Authorization": "Bearer wrong"}
    assert (await client.post("/batch/auto-confirm-orders", headers=bad)).status_code == 401


async def test_nonlocal_batch_auth_never_falls_back_to_default_shared_secret(settings):
    from api.main import create_app
    from httpx import ASGITransport, AsyncClient

    application = create_app(
        settings.model_copy(
            update={
                "env": "staging",
                "edge_proxy_secret": "edge-test-secret",
                "batch_oidc_audience": "",
                "batch_invoker_email": "",
                "batch_token": "dev-batch-token",
            }
        )
    )
    async with application.router.lifespan_context(application):
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="https://test"
        ) as nonlocal_client:
            response = await nonlocal_client.post(
                "/batch/cancel-stale-orders",
                headers={"Authorization": "Bearer dev-batch-token"},
            )
            ready = await nonlocal_client.get(
                "/readyz", headers={"X-Essesion-Edge-Secret": "edge-test-secret"}
            )

    assert response.status_code == 503
    assert response.json()["code"] == "batch_auth_unavailable"
    assert ready.status_code == 503
    assert ready.json()["capabilities"]["batch_auth"] == "unavailable"


async def test_auto_confirm_after_7_days(client, db_session):
    user = await make_user(db_session)
    old = datetime.now(UTC) - timedelta(days=8)
    recent = datetime.now(UTC) - timedelta(days=2)

    eligible = await make_order(db_session, user, status="배송완료", delivered_at=old)
    too_recent = await make_order(db_session, user, status="배송완료", delivered_at=recent)
    shipped = await make_order(db_session, user, status="배송중", shipped_at=old)

    # 활성 클레임 있는 주문은 제외
    claimed = await make_order(db_session, user, status="배송완료", delivered_at=old)
    item = OrderItem(
        order_id=claimed.id, item_id="x", item_type="product", quantity=1, unit_price=1000
    )
    db_session.add(item)
    await db_session.flush()
    db_session.add(
        Claim(
            user_id=user.id,
            order_id=claimed.id,
            order_item_id=item.id,
            claim_number="CLM-TEST-B01",
            type="return",
            status="접수",
            reason="defect",
            quantity=1,
        )
    )
    await db_session.commit()

    res = await client.post("/batch/auto-confirm-orders", headers=BATCH_HEADERS)
    assert res.status_code == 200
    assert res.json()["processed"] == 2

    for order, expected in (
        (eligible, "완료"),
        (too_recent, "배송완료"),
        (shipped, "완료"),
        (claimed, "배송완료"),
    ):
        await db_session.refresh(order)
        assert order.status == expected, order.order_number


async def test_cancel_stale_pending(client, db_session):
    user = await make_user(db_session)
    coupon = await make_coupon(db_session)
    user_coupon = await make_user_coupon(db_session, user, coupon, status="reserved")
    stale = await make_order(
        db_session, user, status="대기중", created_at=datetime.now(UTC) - timedelta(minutes=40)
    )
    fresh = await make_order(db_session, user, status="대기중")
    db_session.add(
        OrderItem(
            order_id=stale.id,
            item_id="stale-coupon",
            item_type="product",
            quantity=1,
            unit_price=10000,
            applied_user_coupon_id=user_coupon.id,
        )
    )
    await db_session.commit()

    res = await client.post("/batch/cancel-stale-orders", headers=BATCH_HEADERS)
    assert res.json()["processed"] == 1

    await db_session.refresh(stale)
    await db_session.refresh(fresh)
    await db_session.refresh(user_coupon)
    assert stale.status == "취소" and fresh.status == "대기중"
    assert user_coupon.status == "active"


async def test_order_batches_process_only_one_bounded_chunk(client, db_session, monkeypatch):
    monkeypatch.setattr("api.domains.batch.router.ORDER_BATCH_SIZE", 2)
    user = await make_user(db_session)
    old = datetime.now(UTC) - timedelta(days=8)
    for _ in range(3):
        await make_order(db_session, user, status="배송완료", delivered_at=old)

    first = await client.post("/batch/auto-confirm-orders", headers=BATCH_HEADERS)
    assert first.status_code == 200
    assert first.json() == {"processed": 2}
    remaining = await db_session.scalar(
        select(func.count()).select_from(Order).where(Order.status == "배송완료")
    )
    assert remaining == 1

    second = await client.post("/batch/auto-confirm-orders", headers=BATCH_HEADERS)
    assert second.json() == {"processed": 1}


async def test_reconcile_stale_finalize_jobs_fails_and_restores_budget(client, db_session):
    user = await make_user(db_session)
    old = datetime.now(UTC) - timedelta(hours=2)
    design_session = DesignSession(user_id=user.id, status="active", finalize_used=3)
    db_session.add(design_session)
    await db_session.flush()
    queued = GenerationJob(
        user_id=user.id,
        session_id=design_session.id,
        kind="finalize",
        status="queued",
        attempts=0,
        params={"intent": {}},
        created_at=old,
        updated_at=old,
    )
    processing = GenerationJob(
        user_id=user.id,
        session_id=design_session.id,
        kind="finalize",
        status="processing",
        attempts=1,
        params={"intent": {}},
        created_at=old,
        updated_at=old,
    )
    temporarily_failed = GenerationJob(
        user_id=user.id,
        session_id=design_session.id,
        kind="finalize",
        status="failed",
        attempts=2,
        params={"intent": {}},
        error_message=FINALIZE_TEMPORARY_FAILURE_MARKER,
        created_at=old,
        updated_at=old,
    )
    fresh = GenerationJob(
        user_id=user.id,
        session_id=design_session.id,
        kind="finalize",
        status="queued",
        attempts=0,
        params={"intent": {}},
    )
    fresh_temporary_failure = GenerationJob(
        user_id=user.id,
        kind="finalize",
        status="failed",
        attempts=1,
        params={"intent": {}},
        error_message=FINALIZE_TEMPORARY_FAILURE_MARKER,
    )
    old_terminal_failure = GenerationJob(
        user_id=user.id,
        kind="finalize",
        status="failed",
        attempts=1,
        params={"intent": {}},
        error_message="FINALIZE_INVALID_INPUT: finalize input is invalid",
        created_at=old,
        updated_at=old,
    )
    db_session.add_all(
        [
            queued,
            processing,
            temporarily_failed,
            fresh,
            fresh_temporary_failure,
            old_terminal_failure,
        ]
    )
    await db_session.commit()

    response = await client.post("/batch/reconcile-stale-generation-jobs", headers=BATCH_HEADERS)

    assert response.status_code == 200
    assert response.json() == {"processed": 3}
    for job in (queued, processing, temporarily_failed):
        await db_session.refresh(job)
        assert job.status == "failed"
        assert job.error_message == FINALIZE_STALE_MESSAGE
    await db_session.refresh(fresh)
    await db_session.refresh(fresh_temporary_failure)
    await db_session.refresh(old_terminal_failure)
    await db_session.refresh(design_session)
    assert fresh.status == "queued"
    assert fresh_temporary_failure.error_message == FINALIZE_TEMPORARY_FAILURE_MARKER
    assert old_terminal_failure.error_message == "FINALIZE_INVALID_INPUT: finalize input is invalid"
    assert design_session.finalize_used == 0


async def test_reconcile_stale_finalize_jobs_is_idempotent(client, db_session):
    user = await make_user(db_session)
    old = datetime.now(UTC) - timedelta(hours=2)
    design_session = DesignSession(user_id=user.id, status="active", finalize_used=1)
    db_session.add(design_session)
    await db_session.flush()
    job = GenerationJob(
        user_id=user.id,
        session_id=design_session.id,
        kind="finalize",
        status="queued",
        attempts=0,
        params={"intent": {}},
        created_at=old,
        updated_at=old,
    )
    db_session.add(job)
    await db_session.commit()

    first = await client.post("/batch/reconcile-stale-generation-jobs", headers=BATCH_HEADERS)
    second = await client.post("/batch/reconcile-stale-generation-jobs", headers=BATCH_HEADERS)

    assert first.json() == {"processed": 1}
    assert second.json() == {"processed": 0}
    await db_session.refresh(design_session)
    assert design_session.finalize_used == 0


async def test_reconcile_stale_finalize_uses_creation_ttl_and_protects_active_lease(
    client, db_session
):
    user = await make_user(db_session)
    now = datetime.now(UTC)
    old = now - timedelta(hours=2)
    design_session = DesignSession(user_id=user.id, status="active", finalize_used=3)
    db_session.add(design_session)
    await db_session.flush()
    active_processing = GenerationJob(
        user_id=user.id,
        session_id=design_session.id,
        kind="finalize",
        status="processing",
        attempts=1,
        params={"intent": {}},
        created_at=old,
        updated_at=now,
    )
    expired_processing = GenerationJob(
        user_id=user.id,
        session_id=design_session.id,
        kind="finalize",
        status="processing",
        attempts=1,
        params={"intent": {}},
        created_at=old,
        updated_at=now - ACTIVE_GENERATION_JOB_LEASE - timedelta(seconds=1),
    )
    recently_failed = GenerationJob(
        user_id=user.id,
        session_id=design_session.id,
        kind="finalize",
        status="failed",
        attempts=2,
        params={"intent": {}},
        error_message=FINALIZE_TEMPORARY_FAILURE_MARKER,
        created_at=old,
        updated_at=now,
    )
    db_session.add_all([active_processing, expired_processing, recently_failed])
    await db_session.commit()

    response = await client.post("/batch/reconcile-stale-generation-jobs", headers=BATCH_HEADERS)

    assert response.status_code == 200
    assert response.json() == {"processed": 2}
    await db_session.refresh(active_processing)
    await db_session.refresh(expired_processing)
    await db_session.refresh(recently_failed)
    await db_session.refresh(design_session)
    assert active_processing.status == "processing"
    assert expired_processing.error_message == FINALIZE_STALE_MESSAGE
    assert recently_failed.error_message == FINALIZE_STALE_MESSAGE
    assert design_session.finalize_used == 1


# ---- OIDC 모드 (배포 환경 — infra/scheduler.tf가 audience·email 주입) ----
# Google 서명 토큰은 실물 생성이 불가하므로 verify_oauth2_token만 목킹
# (RealTossClient를 respx로 목킹하는 기존 선례와 동급 — 인가 규칙 자체는 실경로).

OIDC_AUDIENCE = "https://api-123456.asia-northeast3.run.app"
OIDC_EMAIL = "scheduler-invoker@proj.iam.gserviceaccount.com"


@pytest.fixture
async def oidc_client(settings):
    from api.main import create_app
    from httpx import ASGITransport, AsyncClient

    oidc_settings = settings.model_copy(
        update={"batch_oidc_audience": OIDC_AUDIENCE, "batch_invoker_email": OIDC_EMAIL}
    )
    application = create_app(oidc_settings)
    async with application.router.lifespan_context(application):
        transport = ASGITransport(app=application)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


def _fake_verify(claims_by_token):
    def verify(token, request, audience):
        assert audience == OIDC_AUDIENCE
        if token not in claims_by_token:
            raise ValueError("invalid token")
        return claims_by_token[token]

    return verify


async def test_batch_oidc_valid_token(oidc_client, monkeypatch):
    monkeypatch.setattr(
        "api.deps.id_token.verify_oauth2_token", _fake_verify({"good": {"email": OIDC_EMAIL}})
    )
    res = await oidc_client.post(
        "/batch/cancel-stale-orders", headers={"Authorization": "Bearer good"}
    )
    assert res.status_code == 200


async def test_batch_oidc_wrong_email(oidc_client, monkeypatch):
    monkeypatch.setattr(
        "api.deps.id_token.verify_oauth2_token",
        _fake_verify({"good": {"email": "attacker@other.iam.gserviceaccount.com"}}),
    )
    res = await oidc_client.post(
        "/batch/cancel-stale-orders", headers={"Authorization": "Bearer good"}
    )
    assert res.status_code == 401


async def test_batch_oidc_invalid_token(oidc_client, monkeypatch):
    monkeypatch.setattr("api.deps.id_token.verify_oauth2_token", _fake_verify({}))
    res = await oidc_client.post(
        "/batch/cancel-stale-orders", headers={"Authorization": "Bearer forged"}
    )
    assert res.status_code == 401


async def test_batch_oidc_disables_token_fallback(oidc_client, monkeypatch):
    """OIDC 모드에서는 공유 시크릿(batch_token)이 더 이상 통하지 않는다."""
    monkeypatch.setattr("api.deps.id_token.verify_oauth2_token", _fake_verify({}))
    res = await oidc_client.post("/batch/cancel-stale-orders", headers=BATCH_HEADERS)
    assert res.status_code == 401
