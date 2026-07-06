"""결제 확정 — lock → Toss(respx) → confirm/unlock 멱등 (docs/api-spec/money.md §5)."""

import respx
from db.models.commerce import OrderStatusLog, UserCoupon
from db.models.tokens import DesignToken
from httpx import Response
from sqlalchemy import func, select

from .factories import (
    auth_headers,
    make_address,
    make_coupon,
    make_product,
    make_user,
    make_user_coupon,
    seed_pricing,
)

TOSS_CONFIRM = "https://api.tosspayments.com/v1/payments/confirm"


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
async def test_token_order_confirm_grants_tokens(client, db_session, settings):
    respx.post(TOSS_CONFIRM).mock(return_value=Response(200, json={"status": "DONE"}))
    user = await make_user(db_session)
    await seed_pricing(
        db_session,
        {"token_plan_starter_price": 2500, "token_plan_starter_amount": 100},
        category="token",
    )
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
    assert balance == {"total": 100, "paid": 100, "bonus": 0}

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
