"""결제 확정 — lock → Toss(respx) → confirm/unlock 멱등 (docs/api-spec/money.md §5)."""

import asyncio
import uuid
from datetime import date

import respx
from api.domains.auth.rate_limit import AuthRateLimiter
from api.domains.payments import service as payment_service
from api.domains.tokens import ledger as token_ledger
from api.integrations.toss import RealTossClient, TossResult
from db.models.commerce import (
    Coupon,
    Order,
    OrderItem,
    OrderStatusLog,
    PaymentIncident,
    UserCoupon,
)
from db.models.tokens import DesignToken
from httpx import Response
from sqlalchemy import func, select

from .factories import (
    auth_headers,
    make_address,
    make_admin,
    make_coupon,
    make_order,
    make_product,
    make_user,
    make_user_coupon,
    seed_pricing,
    seed_setting,
)

TOSS_CONFIRM = "https://api.tosspayments.com/v1/payments/confirm"
TOKEN_COST = ("design_token_cost_openai_render_standard", "5")


async def _create_sale_order(client, db_session, settings, user, *, coupon_id=None):
    address = await make_address(db_session, user)
    product = await make_product(db_session, price=10000)
    res = await client.post(
        "/orders",
        json={
            "shipping_address_id": str(address.id),
            "items": [
                {
                    "item_id": f"product:{product.id}",
                    "item_type": "product",
                    "product_id": product.id,
                    "quantity": 1,
                    "applied_user_coupon_id": str(coupon_id) if coupon_id else None,
                }
            ],
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 201
    return res.json()


@respx.mock
async def test_confirm_success_and_idempotency(client, db_session, settings):
    route = respx.post(TOSS_CONFIRM).mock(return_value=Response(200, json={"status": "DONE"}))
    user = await make_user(db_session)
    coupon = await make_coupon(db_session, discount_value=500)
    user_coupon = await make_user_coupon(db_session, user, coupon)
    created = await _create_sale_order(client, db_session, settings, user, coupon_id=user_coupon.id)

    body = {
        "payment_key": "toss-key-abcdefgh",
        "payment_group_id": created["payment_group_id"],
        "amount": created["total_amount"],
    }
    res = await client.post("/payments/confirm", json=body, headers=auth_headers(user, settings))
    assert res.status_code == 200, res.text
    assert res.json()["orders"][0]["status"] == "진행중"
    assert route.call_count == 1

    # 쿠폰 reserved → used
    status = await db_session.scalar(
        select(UserCoupon.status).where(UserCoupon.id == user_coupon.id)
    )
    assert status == "used"

    # 로그: lock + confirmed (payment_key 마스킹)
    memos = (await db_session.scalars(select(OrderStatusLog.memo))).all()
    assert "payment lock" in memos
    assert any(m and m.startswith("payment confirmed: ****") for m in memos)

    # 멱등 — 재호출은 Toss 재호출 없이 DONE
    again = await client.post("/payments/confirm", json=body, headers=auth_headers(user, settings))
    assert again.status_code == 200
    assert route.call_count == 1

    wrong_key = await client.post(
        "/payments/confirm",
        json={**body, "payment_key": "different-key-abcdefgh"},
        headers=auth_headers(user, settings),
    )
    assert wrong_key.status_code == 409
    assert wrong_key.json()["code"] == "payment_key_mismatch"

    wrong_amount = await client.post(
        "/payments/confirm",
        json={**body, "amount": body["amount"] + 1},
        headers=auth_headers(user, settings),
    )
    assert wrong_amount.status_code == 400
    assert wrong_amount.json()["code"] == "amount_mismatch"
    assert route.call_count == 1


@respx.mock
async def test_confirm_rejects_mixed_group_before_mutating_orders(client, db_session, settings):
    """일부만 결제후 상태인 그룹은 성공으로 오인하거나 나머지를 결제중으로 변경하지 않는다."""
    from sqlalchemy import update as sa_update

    user = await make_user(db_session)
    first = await _create_sale_order(client, db_session, settings, user)
    second = await _create_sale_order(client, db_session, settings, user)
    first_id = uuid.UUID(first["orders"][0]["order_id"])
    second_id = uuid.UUID(second["orders"][0]["order_id"])
    group_id = uuid.UUID(first["payment_group_id"])
    await db_session.execute(
        sa_update(Order)
        .where(Order.id == first_id)
        .values(status="진행중", payment_key="existing-key-abcdefgh")
    )
    await db_session.execute(
        sa_update(Order).where(Order.id == second_id).values(payment_group_id=group_id)
    )
    await db_session.commit()

    response = await client.post(
        "/payments/confirm",
        json={
            "payment_key": "new-key-abcdefgh",
            "payment_group_id": str(group_id),
            "amount": first["total_amount"] + second["total_amount"],
        },
        headers=auth_headers(user, settings),
    )
    assert response.status_code == 409
    assert response.json()["code"] == "payment_reconciliation_required"

    states = dict(
        (
            await db_session.execute(
                select(Order.id, Order.status).where(Order.id.in_((first_id, second_id)))
            )
        ).all()
    )
    assert states == {first_id: "진행중", second_id: "대기중"}


@respx.mock
async def test_confirm_failure_unlocks_and_restores_coupon(client, db_session, settings):
    respx.post(TOSS_CONFIRM).mock(
        return_value=Response(400, json={"code": "REJECT_CARD", "message": "카드 거절"})
    )
    user = await make_user(db_session)
    coupon = await make_coupon(db_session, discount_value=500)
    user_coupon = await make_user_coupon(db_session, user, coupon)
    created = await _create_sale_order(client, db_session, settings, user, coupon_id=user_coupon.id)

    res = await client.post(
        "/payments/confirm",
        json={
            "payment_key": "bad-key",
            "payment_group_id": created["payment_group_id"],
            "amount": created["total_amount"],
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "카드 거절"

    order_id = created["orders"][0]["order_id"]
    detail = (await client.get(f"/orders/{order_id}", headers=auth_headers(user, settings))).json()
    assert detail["status"] == "대기중"  # unlock

    status = await db_session.scalar(
        select(UserCoupon.status).where(UserCoupon.id == user_coupon.id)
    )
    assert status == "active"  # 쿠폰 복원


async def test_confirm_amount_mismatch(client, db_session, settings):
    user = await make_user(db_session)
    created = await _create_sale_order(client, db_session, settings, user)
    res = await client.post(
        "/payments/confirm",
        json={
            "payment_key": "k",
            "payment_group_id": created["payment_group_id"],
            "amount": created["total_amount"] + 1,
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Amount mismatch"


@respx.mock
async def test_confirm_rejects_invalid_boundaries_before_toss(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    group_id = "00000000-0000-0000-0000-000000000001"
    invalid_bodies = (
        {"payment_key": "k" * 201, "payment_group_id": group_id, "amount": 1},
        {"payment_key": "key", "payment_group_id": group_id, "amount": 0},
        {"payment_key": "key", "payment_group_id": group_id, "amount": -1},
    )

    for body in invalid_bodies:
        response = await client.post("/payments/confirm", json=body, headers=headers)
        assert response.status_code == 422

    assert len(respx.calls) == 0


@respx.mock
async def test_token_order_confirm_grants_tokens(client, db_session, settings):
    respx.post(TOSS_CONFIRM).mock(return_value=Response(200, json={"status": "DONE"}))
    user = await make_user(db_session)
    await seed_pricing(
        db_session,
        {"token_plan_starter_price": 2500, "token_plan_starter_amount": 100},
        category="token",
    )
    await seed_setting(db_session, *TOKEN_COST)
    headers = auth_headers(user, settings)
    created = (
        await client.post("/tokens/orders", json={"plan_key": "starter"}, headers=headers)
    ).json()
    assert created["order_number"].startswith("TKN-")

    res = await client.post(
        "/payments/confirm",
        json={
            "payment_key": "tok-key-12345678",
            "payment_group_id": created["payment_group_id"],
            "amount": 2500,
        },
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["token_amount"] == 100
    assert res.json()["orders"][0]["status"] == "완료"

    balance = (await client.get("/tokens/balance", headers=headers)).json()
    assert balance == {"total": 100, "paid": 100, "bonus": 0, "generate_cost": 5}

    grant = await db_session.scalar(select(DesignToken).where(DesignToken.type == "purchase"))
    assert grant.expires_at is not None  # 구매 토큰은 +1년 만료


@respx.mock
async def test_sample_confirm_issues_followup_coupon(client, db_session, settings):
    respx.post(TOSS_CONFIRM).mock(return_value=Response(200, json={"status": "DONE"}))
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    await seed_pricing(
        db_session,
        {"SAMPLE_SEWING_COST": 50000, "sample_discount_sewing": 30000},
        category="sample_discount",
    )
    db_session.add(
        Coupon(
            name="SAMPLE_DISCOUNT_SEWING",
            discount_type="fixed",
            discount_value=1,
            max_discount_amount=1,
            expiry_date=date(2027, 1, 1),
            is_active=False,
        )
    )
    await db_session.commit()
    headers = auth_headers(user, settings)
    created = (
        await client.post(
            "/orders/sample",
            json={
                "shipping_address_id": str(address.id),
                "sample_type": "sewing",
                "options": {},
            },
            headers=headers,
        )
    ).json()

    res = await client.post(
        "/payments/confirm",
        json={
            "payment_key": "smp-key-12345678",
            "payment_group_id": created["payment_group_id"],
            "amount": 50000,
        },
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["orders"][0]["status"] == "접수"
    assert res.json()["orders"][0]["coupon_issued"] is True

    mine = (await client.get("/coupons/mine", headers=headers)).json()
    assert mine[0]["coupon"]["name"] == "SAMPLE_DISCOUNT_SEWING"
    assert int(float(mine[0]["coupon"]["discount_value"])) == 30000

    count = await db_session.scalar(select(func.count()).select_from(UserCoupon))
    assert count == 1
    coupon = await db_session.scalar(
        select(Coupon).where(Coupon.name == "SAMPLE_DISCOUNT_SEWING")
    )
    issued = await db_session.scalar(select(UserCoupon))
    assert coupon is not None
    assert issued is not None
    assert issued.terms_snapshot["expiry_date"] == coupon.expiry_date.isoformat()


@respx.mock  # 라우트 미등록 — Toss 호출이 있으면 즉시 실패해 "승인 전 차단"을 보장
async def test_sample_confirm_rejects_unsupported_sample_type_before_toss(
    client, db_session, settings
):
    """미지원 sample_type은 Toss 승인 전에 400 — 승인 후 터지면 수동 개입 창(money.md §5)."""
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="sample", total_price=50000)
    item = OrderItem(
        order_id=order.id,
        item_id=f"smp-{order.id}",
        item_type="sample",
        item_data={"sample_type": "unknown", "options": {}},
        quantity=1,
        unit_price=50000,
    )
    db_session.add(item)
    await db_session.commit()

    res = await client.post(
        "/payments/confirm",
        json={
            "payment_key": "smp-bad-12345678",
            "payment_group_id": str(order.payment_group_id),
            "amount": 50000,
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 400
    assert "sample_type" in res.text

    await db_session.refresh(order)
    assert order.status == "대기중"  # lock 전 차단 — 상태 무변경


TOSS_PAYMENTS = "https://api.tosspayments.com/v1/payments"


@respx.mock
async def test_already_processed_recovers_instead_of_unlock(client, db_session, settings):
    """confirm 재시도가 ALREADY_PROCESSED를 받으면 조회 검증 후 DB 확정 (돈 받고 취소 방지)."""
    user = await make_user(db_session)
    created = await _create_sale_order(client, db_session, settings, user)
    group_id = created["payment_group_id"]

    respx.post(TOSS_CONFIRM).mock(
        return_value=Response(
            400, json={"code": "ALREADY_PROCESSED_PAYMENT", "message": "이미 처리된 결제입니다."}
        )
    )
    respx.get(f"{TOSS_PAYMENTS}/re-key-12345678").mock(
        return_value=Response(
            200,
            json={
                "paymentKey": "re-key-12345678",
                "status": "DONE",
                "orderId": group_id,
                "totalAmount": created["total_amount"],
            },
        )
    )
    res = await client.post(
        "/payments/confirm",
        json={
            "payment_key": "re-key-12345678",
            "payment_group_id": group_id,
            "amount": created["total_amount"],
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 200, res.text
    assert res.json()["orders"][0]["status"] == "진행중"


@respx.mock
async def test_webhook_confirms_stuck_payment(client, db_session, settings):
    """confirm 성공 후 DB 반영 실패로 멈춘 '결제중'을 웹훅 대사가 확정한다."""
    from db.models.commerce import Order
    from sqlalchemy import update as sa_update

    user = await make_user(db_session)
    created = await _create_sale_order(client, db_session, settings, user)
    group_id = created["payment_group_id"]

    # 멈춘 결제중 상태 시뮬레이션
    await db_session.execute(
        sa_update(Order).where(Order.payment_group_id == group_id).values(status="결제중")
    )
    await db_session.commit()

    respx.get(f"{TOSS_PAYMENTS}/stuck-key-1234").mock(
        return_value=Response(
            200,
            json={
                "paymentKey": "stuck-key-1234",
                "status": "DONE",
                "orderId": group_id,
                "totalAmount": created["total_amount"],
            },
        )
    )
    res = await client.post("/payments/webhook", json={"data": {"paymentKey": "stuck-key-1234"}})
    assert res.status_code == 200, res.text
    assert res.json() == {"handled": True, "action": "confirmed", "reason": None, "orders": 1}

    detail = (
        await client.get(
            f"/orders/{created['orders'][0]['order_id']}", headers=auth_headers(user, settings)
        )
    ).json()
    assert detail["status"] == "진행중"

    # 재전송 — 멱등
    replay = await client.post("/payments/webhook", json={"data": {"paymentKey": "stuck-key-1234"}})
    assert replay.json()["action"] == "already_consistent"


@respx.mock
async def test_webhook_done_revalidates_already_consistent_order(client, db_session):
    """완료 주문도 조회 결제키·금액이 다르면 멱등 ACK하지 않고 incident로 남긴다."""
    user = await make_user(db_session)
    stored_key = "stored-done-key-12345678"
    other_key = "other-done-key-12345678"
    order = await make_order(
        db_session,
        user,
        status="진행중",
        total_price=12000,
        payment_key=stored_key,
    )

    respx.get(f"{TOSS_PAYMENTS}/{other_key}").mock(
        return_value=Response(
            200,
            json={
                "paymentKey": other_key,
                "status": "DONE",
                "orderId": str(order.payment_group_id),
                "totalAmount": order.total_price,
            },
        )
    )
    wrong_key = await client.post("/payments/webhook", json={"paymentKey": other_key})
    assert wrong_key.json()["reason"] == "payment_key_mismatch"

    respx.get(f"{TOSS_PAYMENTS}/{stored_key}").mock(
        return_value=Response(
            200,
            json={
                "paymentKey": stored_key,
                "status": "DONE",
                "orderId": str(order.payment_group_id),
                "totalAmount": order.total_price + 1,
            },
        )
    )
    wrong_amount = await client.post("/payments/webhook", json={"paymentKey": stored_key})
    assert wrong_amount.json()["reason"] == "amount_mismatch"

    incidents = list(
        await db_session.scalars(
            select(PaymentIncident).order_by(PaymentIncident.created_at, PaymentIncident.id)
        )
    )
    assert [incident.incident_type for incident in incidents] == [
        "mixed_state",
        "amount_mismatch",
    ]
    assert incidents[0].details["phase"] == "webhook_done_payment_key_mismatch"
    assert incidents[0].details["stored_payment_keys_match_lookup"] is False
    assert incidents[1].details["phase"] == "webhook_done_amount_mismatch"
    await db_session.refresh(order)
    assert order.status == "진행중" and order.payment_key == stored_key


@respx.mock
async def test_webhook_cancel_restores_reserved_coupon(client, db_session, settings):
    """승인 반영 전 전액취소는 주문에 예약된 쿠폰을 다시 사용할 수 있게 한다."""
    user = await make_user(db_session)
    coupon = await make_coupon(db_session, discount_value=500)
    user_coupon = await make_user_coupon(db_session, user, coupon)
    created = await _create_sale_order(
        client,
        db_session,
        settings,
        user,
        coupon_id=user_coupon.id,
    )
    payment_key = "coupon-cancel-key-12345678"
    order = await db_session.scalar(
        select(Order).where(Order.payment_group_id == created["payment_group_id"])
    )
    assert order is not None
    order.status = "결제중"
    order.payment_key = payment_key
    await db_session.commit()

    respx.get(f"{TOSS_PAYMENTS}/{payment_key}").mock(
        return_value=Response(
            200,
            json={
                "paymentKey": payment_key,
                "status": "CANCELED",
                "orderId": created["payment_group_id"],
                "totalAmount": created["total_amount"],
            },
        )
    )
    response = await client.post("/payments/webhook", json={"paymentKey": payment_key})

    assert response.json()["action"] == "canceled"
    await db_session.refresh(order)
    await db_session.refresh(user_coupon)
    assert order.status == "취소"
    assert user_coupon.status == "active"


@respx.mock
async def test_webhook_syncs_dashboard_cancel_with_token_clawback(client, db_session, settings):
    """대시보드 직접 취소 → 주문 취소 동기화 + 토큰 회수(멱등)."""
    from db.models.tokens import DesignToken

    respx.post(TOSS_CONFIRM).mock(return_value=Response(200, json={"status": "DONE"}))
    user = await make_user(db_session)
    await seed_pricing(
        db_session,
        {"token_plan_starter_price": 2500, "token_plan_starter_amount": 100},
        category="token",
    )
    await seed_setting(db_session, *TOKEN_COST)
    headers = auth_headers(user, settings)
    created = (
        await client.post("/tokens/orders", json={"plan_key": "starter"}, headers=headers)
    ).json()
    group_id = created["payment_group_id"]
    await client.post(
        "/payments/confirm",
        json={"payment_key": "cn-key-12345678", "payment_group_id": group_id, "amount": 2500},
        headers=headers,
    )
    assert (await client.get("/tokens/balance", headers=headers)).json()["paid"] == 100

    respx.get(f"{TOSS_PAYMENTS}/cn-key-12345678").mock(
        return_value=Response(
            200,
            json={
                "paymentKey": "cn-key-12345678",
                "status": "CANCELED",
                "orderId": group_id,
                "totalAmount": 2500,
            },
        )
    )
    res = await client.post("/payments/webhook", json={"data": {"paymentKey": "cn-key-12345678"}})
    assert res.json()["action"] == "canceled" and res.json()["orders"] == 1

    orders = (await client.get("/orders", headers=headers)).json()
    assert orders[0]["status"] == "취소"
    assert (await client.get("/tokens/balance", headers=headers)).json()["paid"] == 0

    # 재전송 — 회수 중복 없음 (work_id 멱등)
    await client.post("/payments/webhook", json={"data": {"paymentKey": "cn-key-12345678"}})
    refunds = await db_session.scalar(
        select(func.count()).select_from(DesignToken).where(DesignToken.type == "refund")
    )
    assert refunds == 1
    assert (await client.get("/tokens/balance", headers=headers)).json()["paid"] == 0


@respx.mock
async def test_webhook_cancel_serializes_token_clawback_before_concurrent_use(
    app, client, db_session, settings, monkeypatch
):
    """웹훅이 회수를 시작한 뒤의 토큰 사용은 USER_LOCK에서 대기한다."""

    respx.post(TOSS_CONFIRM).mock(return_value=Response(200, json={"status": "DONE"}))
    user = await make_user(db_session)
    await seed_pricing(
        db_session,
        {"token_plan_starter_price": 2500, "token_plan_starter_amount": 100},
        category="token",
    )
    await seed_setting(db_session, *TOKEN_COST)
    headers = auth_headers(user, settings)
    created = (
        await client.post("/tokens/orders", json={"plan_key": "starter"}, headers=headers)
    ).json()
    group_id = created["payment_group_id"]
    payment_key = "concurrent-cancel-key-12345678"
    confirmed = await client.post(
        "/payments/confirm",
        json={"payment_key": payment_key, "payment_group_id": group_id, "amount": 2500},
        headers=headers,
    )
    assert confirmed.status_code == 200
    expected_payment_key = payment_key

    class CanceledToss:
        capability_mode = "real"

        async def confirm(self, payment_key: str, order_id: str, amount: int) -> TossResult:
            raise AssertionError("confirm must not be called")

        async def cancel(
            self, payment_key: str, reason: str, cancel_amount: int | None = None
        ) -> TossResult:
            raise AssertionError("cancel must not be called")

        async def get_payment(self, payment_key: str) -> TossResult:
            assert payment_key == expected_payment_key
            return TossResult(
                ok=True,
                status=200,
                body={
                    "paymentKey": expected_payment_key,
                    "status": "CANCELED",
                    "orderId": group_id,
                    "totalAmount": 2500,
                },
            )

        async def aclose(self) -> None:
            pass

    clawback_entered = asyncio.Event()
    release_clawback = asyncio.Event()
    original_clawback = payment_service._claw_back_purchased_tokens

    async def paused_clawback(session, order):
        clawback_entered.set()
        await release_clawback.wait()
        await original_clawback(session, order)

    monkeypatch.setattr(payment_service, "_claw_back_purchased_tokens", paused_clawback)

    async def reconcile():
        async with app.state.sessionmaker() as session:
            return await payment_service.reconcile_from_webhook(
                session, CanceledToss(), payment_key
            )

    async def use_tokens():
        async with app.state.sessionmaker() as session:
            return await token_ledger.use_tokens(session, user.id, "webhook-cancel-race")

    webhook_task = asyncio.create_task(reconcile())
    await asyncio.wait_for(clawback_entered.wait(), timeout=5)
    use_task = asyncio.create_task(use_tokens())
    completed_before_clawback, _ = await asyncio.wait({use_task}, timeout=0.1)
    use_was_blocked = not completed_before_clawback
    release_clawback.set()
    webhook_result, use_result = await asyncio.wait_for(
        asyncio.gather(webhook_task, use_task), timeout=5
    )

    assert use_was_blocked
    assert webhook_result == {"handled": True, "action": "canceled", "orders": 1}
    assert use_result.success is False
    assert use_result.error == "insufficient_tokens"
    assert use_result.balance == 0
    assert (await token_ledger.get_balance(db_session, user.id))["paid"] == 0
    uses = await db_session.scalar(
        select(func.count()).select_from(DesignToken).where(DesignToken.type == "use")
    )
    assert uses == 0


@respx.mock
async def test_webhook_cancel_payment_key_mismatch_keeps_order_and_opens_incident(
    client, db_session, settings
):
    respx.post(TOSS_CONFIRM).mock(return_value=Response(200, json={"status": "DONE"}))
    user = await make_user(db_session)
    admin = await make_admin(db_session)
    created = await _create_sale_order(client, db_session, settings, user)
    headers = auth_headers(user, settings)
    await client.post(
        "/payments/confirm",
        json={
            "payment_key": "current-key-12345678",
            "payment_group_id": created["payment_group_id"],
            "amount": created["total_amount"],
        },
        headers=headers,
    )
    respx.get(f"{TOSS_PAYMENTS}/old-key-12345678").mock(
        return_value=Response(
            200,
            json={
                "paymentKey": "old-key-12345678",
                "status": "CANCELED",
                "orderId": created["payment_group_id"],
                "totalAmount": created["total_amount"],
            },
        )
    )

    response = await client.post(
        "/payments/webhook", json={"data": {"paymentKey": "old-key-12345678"}}
    )
    assert response.json()["reason"] == "payment_key_mismatch"
    order = await db_session.scalar(
        select(Order).where(Order.payment_group_id == created["payment_group_id"])
    )
    assert order is not None and order.status == "진행중"
    incidents = list(
        await db_session.scalars(
            select(PaymentIncident).where(PaymentIncident.incident_type == "mixed_state")
        )
    )
    assert len(incidents) == 1 and incidents[0].status == "open"
    incident = incidents[0]
    assert incident.details["lookup_payment_key"] == "old-key-12345678"

    detail = await client.get(
        f"/admin/payment-incidents/{incident.id}", headers=auth_headers(admin, settings)
    )
    assert detail.status_code == 200
    assert detail.json()["details"]["lookup_payment_key"] == "[redacted]"

    # Toss 재전송에도 같은 불일치 incident를 중복 생성하지 않는다.
    await client.post("/payments/webhook", json={"data": {"paymentKey": "old-key-12345678"}})
    count = await db_session.scalar(
        select(func.count())
        .select_from(PaymentIncident)
        .where(PaymentIncident.incident_type == "mixed_state")
    )
    assert count == 1

    # 현재 주문 키가 아니라 사고를 만든 old key로 조회해야 대사가 가능하다.
    reconciled = await client.post(
        f"/admin/payment-incidents/{incident.id}/reconcile",
        headers=auth_headers(admin, settings),
    )
    assert reconciled.status_code == 200, reconciled.text
    evidence = reconciled.json()["details"]["reconciliation"]
    assert evidence["provider_payment_key_matches"] is True
    assert evidence["manual_resolution_allowed"] is False
    await db_session.refresh(incident)
    assert incident.details["lookup_payment_key"] == "old-key-12345678"

    blocked = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(uuid.uuid4()), "memo": "이전 결제 취소 증거 확인"},
        headers=auth_headers(admin, settings),
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "reconciliation_required"
    detail = await client.get(
        f"/admin/payment-incidents/{incident.id}", headers=auth_headers(admin, settings)
    )
    resolve_action = next(
        action for action in detail.json()["admin_actions"] if action["kind"] == "resolve"
    )
    assert resolve_action["enabled"] is False
    assert "현재 주문 결제 키" in resolve_action["blocking_reason"]


@respx.mock
async def test_webhook_cancel_amount_mismatch_keeps_order_and_opens_incident(
    client, db_session, settings
):
    respx.post(TOSS_CONFIRM).mock(return_value=Response(200, json={"status": "DONE"}))
    user = await make_user(db_session)
    created = await _create_sale_order(client, db_session, settings, user)
    headers = auth_headers(user, settings)
    payment_key = "cancel-amount-key-12345678"
    await client.post(
        "/payments/confirm",
        json={
            "payment_key": payment_key,
            "payment_group_id": created["payment_group_id"],
            "amount": created["total_amount"],
        },
        headers=headers,
    )
    respx.get(f"{TOSS_PAYMENTS}/{payment_key}").mock(
        return_value=Response(
            200,
            json={
                "paymentKey": payment_key,
                "status": "CANCELED",
                "orderId": created["payment_group_id"],
                "totalAmount": created["total_amount"] + 1,
            },
        )
    )

    response = await client.post("/payments/webhook", json={"data": {"paymentKey": payment_key}})
    assert response.json()["reason"] == "amount_mismatch"
    order = await db_session.scalar(
        select(Order).where(Order.payment_group_id == created["payment_group_id"])
    )
    assert order is not None and order.status == "진행중"
    incident = await db_session.scalar(
        select(PaymentIncident).where(PaymentIncident.incident_type == "mixed_state")
    )
    assert incident is not None and incident.status == "open"
    assert incident.expected_amount == created["total_amount"]
    assert incident.observed_amount == created["total_amount"] + 1
    assert incident.details["reason"] == "amount_mismatch"


@respx.mock
async def test_webhook_retries_ambiguous_provider_4xx_without_caching(client):
    for status in (400, 401, 403, 429):
        payment_key = f"retryable-{status}-key"
        route = respx.get(f"{TOSS_PAYMENTS}/{payment_key}").mock(
            return_value=Response(status, json={"code": "PROVIDER_ERROR"})
        )

        first = await client.post("/payments/webhook", json={"paymentKey": payment_key})
        second = await client.post("/payments/webhook", json={"paymentKey": payment_key})

        assert first.status_code == second.status_code == 502
        assert first.json()["code"] == second.json()["code"] == "upstream_error"
        assert route.call_count == 2


@respx.mock
async def test_webhook_caches_explicit_provider_payment_not_found(client):
    route = respx.get(f"{TOSS_PAYMENTS}/explicit-missing-key").mock(
        return_value=Response(400, json={"code": "NOT_FOUND_PAYMENT"})
    )

    first = await client.post("/payments/webhook", json={"paymentKey": "explicit-missing-key"})
    second = await client.post("/payments/webhook", json={"paymentKey": "explicit-missing-key"})

    assert first.status_code == second.status_code == 200
    assert first.json()["reason"] == second.json()["reason"] == "payment_not_found"
    assert route.call_count == 1


@respx.mock
async def test_webhook_done_mixed_state_opens_one_incident(client, db_session, settings):
    user = await make_user(db_session)
    admin = await make_admin(db_session)
    order = await make_order(db_session, user, status="대기중", total_price=12000)
    payment_key = "done-mixed-state-key"
    route = respx.get(f"{TOSS_PAYMENTS}/{payment_key}").mock(
        return_value=Response(
            200,
            json={
                "paymentKey": payment_key,
                "status": "DONE",
                "orderId": str(order.payment_group_id),
                "totalAmount": order.total_price,
            },
        )
    )

    first = await client.post("/payments/webhook", json={"paymentKey": payment_key})
    second = await client.post("/payments/webhook", json={"paymentKey": payment_key})

    assert first.status_code == second.status_code == 200
    assert first.json()["reason"] == second.json()["reason"] == "inconsistent_state"
    incidents = list(
        await db_session.scalars(
            select(PaymentIncident).where(PaymentIncident.incident_type == "mixed_state")
        )
    )
    assert len(incidents) == 1
    assert incidents[0].order_id == order.id
    assert incidents[0].expected_amount == order.total_price
    assert incidents[0].observed_amount == order.total_price
    assert incidents[0].details["phase"] == "webhook_done_mixed_state"
    assert incidents[0].details["lookup_payment_key"] == payment_key
    assert route.call_count == 2

    # 주문에 payment_key가 없어도 incident 원인 키로 대사하고 수동 조치를 기록한다.
    incident = incidents[0]
    reconciled = await client.post(
        f"/admin/payment-incidents/{incident.id}/reconcile",
        headers=auth_headers(admin, settings),
    )
    assert reconciled.status_code == 200, reconciled.text
    assert reconciled.json()["details"]["lookup_payment_key"] == "[redacted]"
    evidence = reconciled.json()["details"]["reconciliation"]
    assert evidence["manual_resolution_allowed"] is False
    assert evidence["domain_consistent"] is False
    await db_session.refresh(incident)
    assert incident.details["lookup_payment_key"] == payment_key

    blocked = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(uuid.uuid4()), "memo": "혼합 상태 수동 조치 완료"},
        headers=auth_headers(admin, settings),
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "reconciliation_required"
    await db_session.refresh(incident)
    assert incident.status == "open"

    # 운영자가 주문 도메인을 실제 provider DONE 상태에 맞춘 뒤에만 종료 가능하다.
    order.status = "진행중"
    order.payment_key = payment_key
    await db_session.commit()
    reconciled_after_domain_fix = await client.post(
        f"/admin/payment-incidents/{incident.id}/reconcile",
        headers=auth_headers(admin, settings),
    )
    assert reconciled_after_domain_fix.status_code == 200
    fixed_evidence = reconciled_after_domain_fix.json()["details"]["reconciliation"]
    assert fixed_evidence["domain_consistent"] is True
    assert fixed_evidence["apply_result"] == "already_consistent"

    resolved = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(uuid.uuid4()), "memo": "주문 상태 수동 교정 후 재검증"},
        headers=auth_headers(admin, settings),
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"


@respx.mock
async def test_webhook_done_amount_mismatch_opens_one_incident(client, db_session, settings):
    user = await make_user(db_session)
    admin = await make_admin(db_session)
    payment_key = "done-amount-mismatch-key"
    order = await make_order(
        db_session,
        user,
        status="결제중",
        total_price=12000,
    )
    route = respx.get(f"{TOSS_PAYMENTS}/{payment_key}").mock(
        return_value=Response(
            200,
            json={
                "paymentKey": payment_key,
                "status": "DONE",
                "orderId": str(order.payment_group_id),
                "totalAmount": order.total_price + 1,
            },
        )
    )

    first = await client.post("/payments/webhook", json={"paymentKey": payment_key})
    second = await client.post("/payments/webhook", json={"paymentKey": payment_key})

    assert first.status_code == second.status_code == 200
    assert first.json()["reason"] == second.json()["reason"] == "amount_mismatch"
    incidents = list(
        await db_session.scalars(
            select(PaymentIncident).where(PaymentIncident.incident_type == "amount_mismatch")
        )
    )
    assert len(incidents) == 1
    assert incidents[0].order_id == order.id
    assert incidents[0].expected_amount == order.total_price
    assert incidents[0].observed_amount == order.total_price + 1
    assert incidents[0].details["phase"] == "webhook_done_amount_mismatch"
    assert incidents[0].details["lookup_payment_key"] == payment_key
    assert order.payment_key is None
    assert route.call_count == 2

    incident = incidents[0]
    blind_resolve = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(uuid.uuid4()), "memo": "검증 없이 종료"},
        headers=auth_headers(admin, settings),
    )
    assert blind_resolve.status_code == 409
    assert blind_resolve.json()["code"] == "reconciliation_required"

    # 다른 금액의 CANCELED를 반복 조회해도 최초 관측값을 덮어써 우회할 수 없다.
    route.mock(
        return_value=Response(
            200,
            json={
                "paymentKey": payment_key,
                "status": "CANCELED",
                "orderId": str(order.payment_group_id),
                "totalAmount": order.total_price + 2,
            },
        )
    )
    for _ in range(2):
        rejected = await client.post(
            f"/admin/payment-incidents/{incident.id}/reconcile",
            headers=auth_headers(admin, settings),
        )
        assert rejected.status_code == 200
        assert rejected.json()["details"]["reconciliation"]["amount_matches"] is False
        await db_session.refresh(incident)
        await db_session.refresh(order)
        assert incident.observed_amount == order.total_price + 1
        assert order.status == "결제중"

    # 잘못 승인된 동일 결제가 Toss에서 전액 취소된 뒤에만 내부 주문을 취소한다.
    route.mock(
        return_value=Response(
            200,
            json={
                "paymentKey": payment_key,
                "status": "CANCELED",
                "orderId": str(order.payment_group_id),
                "totalAmount": order.total_price + 1,
            },
        )
    )
    reconciled = await client.post(
        f"/admin/payment-incidents/{incident.id}/reconcile",
        headers=auth_headers(admin, settings),
    )
    assert reconciled.status_code == 200, reconciled.text
    evidence = reconciled.json()["details"]["reconciliation"]
    assert evidence["provider_payment_key_matches"] is True
    assert evidence["provider_status"] == "CANCELED"
    assert evidence["amount_matches"] is True
    assert evidence["domain_consistent"] is True
    assert evidence["apply_result"] == "canceled"
    assert reconciled.json()["details"]["lookup_payment_key"] == "[redacted]"
    await db_session.refresh(order)
    await db_session.refresh(incident)
    assert order.status == "취소"
    assert order.payment_key == payment_key
    assert incident.details["lookup_payment_key"] == payment_key

    resolved = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(uuid.uuid4()), "memo": "Toss 전액취소 및 내부 취소 확인"},
        headers=auth_headers(admin, settings),
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"


@respx.mock
async def test_webhook_partial_cancel_opens_one_incident(client, db_session):
    user = await make_user(db_session)
    payment_key = "partial-cancel-key"
    order = await make_order(
        db_session,
        user,
        status="진행중",
        total_price=12000,
        payment_key=payment_key,
    )
    cancel_amounts = [3000]

    def payment_lookup(_request):
        canceled_total = sum(cancel_amounts)
        return Response(
            200,
            json={
                "paymentKey": payment_key,
                "status": "PARTIAL_CANCELED",
                "orderId": str(order.payment_group_id),
                "totalAmount": order.total_price,
                "balanceAmount": order.total_price - canceled_total,
                "cancels": [{"cancelAmount": amount} for amount in cancel_amounts],
            },
        )

    route = respx.get(f"{TOSS_PAYMENTS}/{payment_key}").mock(side_effect=payment_lookup)

    first = await client.post("/payments/webhook", json={"paymentKey": payment_key})
    second = await client.post("/payments/webhook", json={"paymentKey": payment_key})

    assert first.status_code == second.status_code == 200
    assert first.json()["reason"] == second.json()["reason"] == "partial_cancel_manual"
    incidents = list(
        await db_session.scalars(
            select(PaymentIncident).where(PaymentIncident.incident_type == "partial_cancel")
        )
    )
    assert len(incidents) == 1
    assert incidents[0].order_id == order.id
    assert incidents[0].expected_amount == order.total_price
    assert incidents[0].observed_amount == 3000
    assert incidents[0].details["phase"] == "webhook_partial_canceled"
    assert route.call_count == 2

    # 동일 webhook 재전송은 중복 기록하지 않지만, 이후 누적 부분취소 금액이
    # 달라지면 앞선 사고가 이미 해소됐더라도 새 관리자 사고로 남겨야 한다.
    incidents[0].status = "resolved"
    await db_session.commit()
    cancel_amounts.append(2000)

    third = await client.post("/payments/webhook", json={"paymentKey": payment_key})

    assert third.status_code == 200
    assert third.json()["reason"] == "partial_cancel_manual"
    incidents = list(
        await db_session.scalars(
            select(PaymentIncident)
            .where(PaymentIncident.incident_type == "partial_cancel")
            .order_by(PaymentIncident.observed_amount)
        )
    )
    assert [(incident.status, incident.observed_amount) for incident in incidents] == [
        ("resolved", 3000),
        ("open", 5000),
    ]
    assert route.call_count == 3


@respx.mock
async def test_webhook_ignores_forged_and_mismatched_payloads(client, db_session, settings):
    """위조 페이로드는 조회 재검증에서 걸러지고, 금액 불일치는 확정하지 않는다."""
    user = await make_user(db_session)
    created = await _create_sale_order(client, db_session, settings, user)
    group_id = created["payment_group_id"]

    # 조회 404 = Toss에 없는 결제 (위조)
    respx.get(f"{TOSS_PAYMENTS}/forged-key").mock(
        return_value=Response(404, json={"code": "NOT_FOUND_PAYMENT"})
    )
    res = await client.post("/payments/webhook", json={"paymentKey": "forged-key"})
    assert res.json() == {
        "handled": False,
        "action": None,
        "reason": "payment_not_found",
        "orders": None,
    }

    # paymentKey 없음
    res = await client.post("/payments/webhook", json={"eventType": "x"})
    assert res.json()["reason"] == "no_payment_key"

    # 금액 불일치 — 확정 거부
    from db.models.commerce import Order
    from sqlalchemy import update as sa_update

    await db_session.execute(
        sa_update(Order).where(Order.payment_group_id == group_id).values(status="결제중")
    )
    await db_session.commit()
    respx.get(f"{TOSS_PAYMENTS}/tampered-key").mock(
        return_value=Response(
            200,
            json={
                "paymentKey": "tampered-key",
                "status": "DONE",
                "orderId": group_id,
                "totalAmount": created["total_amount"] + 1,
            },
        )
    )
    res = await client.post("/payments/webhook", json={"data": {"paymentKey": "tampered-key"}})
    assert res.json()["reason"] == "amount_mismatch"
    orders = (await client.get("/orders", headers=auth_headers(user, settings))).json()
    assert orders[0]["status"] == "결제중"  # 그대로 — 수동 확인 대상


@respx.mock
async def test_webhook_rejects_overlong_payment_key_before_provider_call(client):
    response = await client.post(
        "/payments/webhook",
        json={"data": {"paymentKey": "k" * 201}},
    )

    assert response.status_code == 422
    assert len(respx.calls) == 0


@respx.mock
async def test_webhook_suppresses_repeated_invalid_payment_key(client):
    route = respx.get(f"{TOSS_PAYMENTS}/invalid-key").mock(
        return_value=Response(404, json={"code": "NOT_FOUND_PAYMENT"})
    )

    first = await client.post("/payments/webhook", json={"paymentKey": "invalid-key"})
    second = await client.post("/payments/webhook", json={"paymentKey": "invalid-key"})

    assert first.status_code == second.status_code == 200
    assert first.json()["reason"] == second.json()["reason"] == "payment_not_found"
    assert route.call_count == 1


@respx.mock
async def test_webhook_rate_limit_blocks_repeated_client_requests(app, client):
    app.state.toss_webhook_rate_limiter = AuthRateLimiter(
        attempts=1,
        window_seconds=60,
        max_keys=10,
        detail="결제 웹훅 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    )
    respx.get(f"{TOSS_PAYMENTS}/first-invalid-key").mock(
        return_value=Response(404, json={"code": "NOT_FOUND_PAYMENT"})
    )

    first = await client.post("/payments/webhook", json={"paymentKey": "first-invalid-key"})
    blocked = await client.post("/payments/webhook", json={"paymentKey": "second-invalid-key"})

    assert first.status_code == 200
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "rate_limited"


@respx.mock
async def test_toss_payment_key_is_encoded_as_one_path_segment():
    get_route = respx.get().mock(return_value=Response(404, json={"code": "NOT_FOUND_PAYMENT"}))
    cancel_route = respx.post().mock(return_value=Response(404, json={"code": "NOT_FOUND_PAYMENT"}))
    toss = RealTossClient("test-secret")
    payment_key = "key/with?query% and-space"

    try:
        await toss.get_payment(payment_key)
        await toss.cancel(payment_key, "test")
        await toss.get_payment("..")
    finally:
        await toss.aclose()

    encoded = b"key%2Fwith%3Fquery%25%20and-space"
    assert get_route.calls[0].request.url.raw_path == b"/v1/payments/" + encoded
    assert cancel_route.calls[0].request.url.raw_path == b"/v1/payments/" + encoded + b"/cancel"
    assert get_route.calls[0].request.url.query == b""
    assert cancel_route.calls[0].request.url.query == b""
    assert get_route.calls[1].request.url.raw_path == b"/v1/payments/%2E%2E"
