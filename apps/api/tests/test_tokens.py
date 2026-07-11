"""토큰 원장 — 유료 우선·만료 임박순 차감·work_id 멱등·환불 (money.md §6)."""

from datetime import UTC, datetime, timedelta

import respx
from api.domains.tokens import ledger
from db.models.tokens import DesignToken
from httpx import Response
from sqlalchemy import select

from .factories import auth_headers, make_user, seed_pricing, seed_setting

COST_SETTING = ("design_token_cost_openai_render_standard", "5")


def _grant(user_id, amount, token_class="free", **kw):
    return DesignToken(user_id=user_id, amount=amount, type="grant", token_class=token_class, **kw)


async def test_use_tokens_bonus_only_and_idempotency(db_session):
    await seed_setting(db_session, *COST_SETTING)
    user = await make_user(db_session)
    db_session.add(_grant(user.id, 30))
    await db_session.commit()

    result = await ledger.use_tokens(db_session, user.id, "work-1")
    assert result.success and result.cost == 5 and result.balance == 25

    # 같은 work_id 재호출 — 추가 차감 없음
    again = await ledger.use_tokens(db_session, user.id, "work-1")
    assert again.success and again.balance == 25

    balance = await ledger.get_balance(db_session, user.id)
    assert balance == {"total": 25, "paid": 0, "bonus": 25}


async def test_use_tokens_paid_first_expiry_order(db_session):
    await seed_setting(db_session, *COST_SETTING)
    user = await make_user(db_session)
    later = datetime.now(UTC) + timedelta(days=10)
    sooner = datetime.now(UTC) + timedelta(days=5)
    db_session.add(
        DesignToken(
            user_id=user.id, amount=3, type="purchase", token_class="paid", expires_at=later
        )
    )
    db_session.add(
        DesignToken(
            user_id=user.id, amount=4, type="purchase", token_class="paid", expires_at=sooner
        )
    )
    db_session.add(_grant(user.id, 10, token_class="bonus"))
    await db_session.commit()

    result = await ledger.use_tokens(db_session, user.id, "work-2")
    assert result.success and result.balance == 12

    uses = (
        await db_session.scalars(
            select(DesignToken).where(DesignToken.type == "use").order_by(DesignToken.work_id)
        )
    ).all()
    by_work = {u.work_id: u for u in uses}
    # 만료 임박(sooner) 배치에서 4, 다음 배치에서 1 — 보너스는 안 씀
    assert by_work["work-2_use_paid_0"].amount == -4
    assert by_work["work-2_use_paid_0"].expires_at is not None
    assert by_work["work-2_use_paid_1"].amount == -1
    assert "work-2_use_bonus" not in by_work


async def test_use_tokens_insufficient(db_session):
    await seed_setting(db_session, *COST_SETTING)
    user = await make_user(db_session)
    db_session.add(_grant(user.id, 3))
    await db_session.commit()
    result = await ledger.use_tokens(db_session, user.id, "work-3")
    assert not result.success and result.error == "insufficient_tokens"


async def test_expired_tokens_excluded_from_balance(db_session):
    user = await make_user(db_session)
    db_session.add(
        DesignToken(
            user_id=user.id,
            amount=100,
            type="purchase",
            token_class="paid",
            expires_at=datetime.now(UTC) - timedelta(days=1),
        )
    )
    await db_session.commit()
    assert (await ledger.get_balance(db_session, user.id))["total"] == 0


async def test_balance_endpoint_includes_generate_cost(client, db_session, settings):
    await seed_setting(db_session, *COST_SETTING)
    user = await make_user(db_session)

    response = await client.get("/tokens/balance", headers=auth_headers(user, settings))

    assert response.status_code == 200
    assert response.json() == {"total": 0, "paid": 0, "bonus": 0, "generate_cost": 5}


async def test_history_is_owned_newest_first_paginated_and_filterable(client, db_session, settings):
    user = await make_user(db_session)
    other = await make_user(db_session)
    base = datetime(2026, 1, 1, tzinfo=UTC)
    entries = [
        DesignToken(
            user_id=user.id,
            amount=10,
            type="purchase",
            token_class="paid",
            created_at=base,
        ),
        DesignToken(
            user_id=user.id,
            amount=-3,
            type="use",
            token_class="paid",
            created_at=base + timedelta(minutes=1),
        ),
        DesignToken(
            user_id=user.id,
            amount=3,
            type="refund",
            token_class="paid",
            created_at=base + timedelta(minutes=2),
        ),
        DesignToken(
            user_id=user.id,
            amount=5,
            type="admin",
            token_class="bonus",
            description="관리자 지급",
            created_at=base + timedelta(minutes=3),
        ),
        DesignToken(
            user_id=user.id,
            amount=-1,
            type="admin",
            token_class="paid",
            description="관리자 회수",
            created_at=base + timedelta(minutes=4),
        ),
        DesignToken(
            user_id=other.id,
            amount=99,
            type="grant",
            token_class="free",
            created_at=base + timedelta(minutes=5),
        ),
    ]
    db_session.add_all(entries)
    await db_session.commit()
    headers = auth_headers(user, settings)

    page = await client.get("/tokens/history?limit=2&offset=1", headers=headers)
    assert page.status_code == 200
    assert [row["id"] for row in page.json()] == [str(entries[3].id), str(entries[2].id)]

    credit = await client.get("/tokens/history?type=credit", headers=headers)
    assert [row["id"] for row in credit.json()] == [str(entries[3].id), str(entries[0].id)]
    assert [row["type"] for row in credit.json()] == ["admin", "purchase"]

    used = await client.get("/tokens/history?type=use", headers=headers)
    assert [row["id"] for row in used.json()] == [str(entries[1].id)]

    refunded = await client.get("/tokens/history?type=refund", headers=headers)
    assert [row["id"] for row in refunded.json()] == [str(entries[2].id)]


async def test_plans_endpoint(client, db_session):
    await seed_pricing(
        db_session,
        {
            "token_plan_starter_price": 2500,
            "token_plan_starter_amount": 100,
            "token_plan_popular_price": 6500,
            "token_plan_popular_amount": 300,
            "token_plan_pro_price": 18000,
            "token_plan_pro_amount": 1000,
        },
        category="token",
    )
    res = await client.get("/tokens/plans")
    assert res.status_code == 200
    assert res.json()[0] == {"plan_key": "starter", "price": 2500, "token_amount": 100}


async def _completed_token_order(client, db_session, settings, user, *, amount=100, price=2500):
    """구매 확정된 토큰 주문 셋업 (결제 플로우는 test_payments에서 검증 — 여기선 직접 구성)."""
    from .factories import make_order

    order = await make_order(db_session, user, order_type="token", status="완료", total_price=price)
    order.payment_key = "paid-key-12345678"
    from db.models.commerce import OrderItem

    db_session.add(
        OrderItem(
            order_id=order.id,
            item_id=f"token-order-{order.id}",
            item_type="token",
            item_data={"plan_key": "starter", "token_amount": amount},
            quantity=1,
            unit_price=price,
        )
    )
    db_session.add(
        DesignToken(
            user_id=user.id,
            amount=amount,
            type="purchase",
            token_class="paid",
            work_id=f"order_{order.id}",
            source_order_id=order.id,
            expires_at=datetime.now(UTC) + timedelta(days=365),
        )
    )
    await db_session.commit()
    return order


async def test_refund_request_rules(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    old_order = await _completed_token_order(client, db_session, settings, user)
    new_order = await _completed_token_order(client, db_session, settings, user)

    # 최신 주문이 아니면 거부
    res = await client.post(
        "/tokens/refund-requests", json={"order_id": str(old_order.id)}, headers=headers
    )
    assert res.status_code == 400 and res.json()["detail"] == "not the latest order"

    refundable = (await client.get("/tokens/refundable-orders", headers=headers)).json()
    assert {r["order_id"]: r["is_refundable"] for r in refundable} == {
        str(new_order.id): True,
        str(old_order.id): False,
    }

    # 최신 주문 환불 요청 성공
    res = await client.post(
        "/tokens/refund-requests", json={"order_id": str(new_order.id)}, headers=headers
    )
    assert res.status_code == 201, res.text
    assert res.json()["refund_amount"] == 2500
    assert res.json()["claim_number"].startswith("TKR-")

    refundable = (await client.get("/tokens/refundable-orders", headers=headers)).json()
    pending = next(row for row in refundable if row["order_id"] == str(new_order.id))
    assert pending["reason"] == "pending_refund"
    assert pending["claim_id"] == res.json()["claim_id"]

    # 중복 요청 거부
    dup = await client.post(
        "/tokens/refund-requests", json={"order_id": str(new_order.id)}, headers=headers
    )
    assert dup.status_code == 400 and dup.json()["detail"] == "duplicate_refund_request"

    granted = await db_session.scalar(
        select(DesignToken).where(DesignToken.source_order_id == new_order.id)
    )
    assert granted is not None
    granted.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()
    pending_after_expiry = (await client.get("/tokens/refundable-orders", headers=headers)).json()
    pending = next(row for row in pending_after_expiry if row["order_id"] == str(new_order.id))
    assert pending["reason"] == "pending_refund"
    assert pending["claim_id"] == res.json()["claim_id"]


async def test_refund_request_blocked_after_use(client, db_session, settings):
    await seed_setting(db_session, *COST_SETTING)
    user = await make_user(db_session)
    order = await _completed_token_order(client, db_session, settings, user)
    await ledger.use_tokens(db_session, user.id, "work-after")
    res = await client.post(
        "/tokens/refund-requests",
        json={"order_id": str(order.id)},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 400 and res.json()["detail"] == "tokens_used_after_order"


@respx.mock
async def test_refund_approve_cancels_payment_and_order(client, db_session, settings):
    cancel_route = respx.post(
        "https://api.tosspayments.com/v1/payments/paid-key-12345678/cancel"
    ).mock(return_value=Response(200, json={"status": "CANCELED"}))

    user = await make_user(db_session)
    from .factories import make_admin

    admin = await make_admin(db_session)
    order = await _completed_token_order(client, db_session, settings, user)
    claim_id = (
        await client.post(
            "/tokens/refund-requests",
            json={"order_id": str(order.id)},
            headers=auth_headers(user, settings),
        )
    ).json()["claim_id"]

    res = await client.post(
        f"/admin/token-refunds/{claim_id}/approve", headers=auth_headers(admin, settings)
    )
    assert res.status_code == 200, res.text
    assert cancel_route.call_count == 1

    balance = await ledger.get_balance(db_session, user.id)
    assert balance["paid"] == 0  # 회수 완료

    detail = (await client.get(f"/orders/{order.id}", headers=auth_headers(user, settings))).json()
    assert detail["status"] == "취소"

    refundable = (
        await client.get("/tokens/refundable-orders", headers=auth_headers(user, settings))
    ).json()
    approved = next(row for row in refundable if row["order_id"] == str(order.id))
    assert approved["reason"] == "approved_refund"
    assert approved["claim_id"] == claim_id

    # 멱등 — 재승인은 Toss 재호출 없음
    again = await client.post(
        f"/admin/token-refunds/{claim_id}/approve", headers=auth_headers(admin, settings)
    )
    assert again.status_code == 200 and again.json()["already_approved"] is True
    assert cancel_route.call_count == 1


@respx.mock
async def test_previous_order_becomes_refundable_after_latest_refund(client, db_session, settings):
    cancel_route = respx.post(
        "https://api.tosspayments.com/v1/payments/paid-key-12345678/cancel"
    ).mock(return_value=Response(200, json={"status": "CANCELED"}))
    user = await make_user(db_session)
    from .factories import make_admin

    admin = await make_admin(db_session)
    previous_order = await _completed_token_order(client, db_session, settings, user)
    latest_order = await _completed_token_order(client, db_session, settings, user)
    claim_id = (
        await client.post(
            "/tokens/refund-requests",
            json={"order_id": str(latest_order.id)},
            headers=auth_headers(user, settings),
        )
    ).json()["claim_id"]

    approved = await client.post(
        f"/admin/token-refunds/{claim_id}/approve",
        headers=auth_headers(admin, settings),
    )
    assert approved.status_code == 200
    assert cancel_route.call_count == 1

    rows = (
        await client.get("/tokens/refundable-orders", headers=auth_headers(user, settings))
    ).json()
    by_order_id = {row["order_id"]: row for row in rows}
    assert by_order_id[str(latest_order.id)]["reason"] == "approved_refund"
    assert by_order_id[str(previous_order.id)]["is_refundable"] is True


async def test_admin_manage_insufficient(client, db_session, settings):
    from .factories import make_admin

    admin = await make_admin(db_session)
    user = await make_user(db_session)
    res = await client.post(
        "/admin/tokens/manage",
        json={"user_id": str(user.id), "amount": -10, "description": "회수"},
        headers=auth_headers(admin, settings),
    )
    assert res.status_code == 400 and res.json()["detail"] == "insufficient_tokens"
