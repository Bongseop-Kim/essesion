"""배치 — 자동확정 7일 / stale 취소 30분 (money.md §7)."""

from datetime import UTC, datetime, timedelta

from db.models.commerce import Claim, OrderItem

from .factories import make_order, make_user

BATCH_HEADERS = {"Authorization": "Bearer test-batch-token"}


async def test_batch_requires_token(client):
    assert (await client.post("/batch/auto-confirm-orders")).status_code == 401
    bad = {"Authorization": "Bearer wrong"}
    assert (await client.post("/batch/auto-confirm-orders", headers=bad)).status_code == 401


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
    stale = await make_order(
        db_session, user, status="대기중", created_at=datetime.now(UTC) - timedelta(minutes=40)
    )
    fresh = await make_order(db_session, user, status="대기중")

    res = await client.post("/batch/cancel-stale-orders", headers=BATCH_HEADERS)
    assert res.json()["processed"] == 1

    await db_session.refresh(stale)
    await db_session.refresh(fresh)
    assert stale.status == "취소" and fresh.status == "대기중"
