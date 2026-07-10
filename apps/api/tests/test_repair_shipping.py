"""수선 발송 확인 — 송장(선택)·사유(선택)·관리자 강제 접수 (money.md §9 의도적 차이)."""

from db.models.commerce import RepairShippingReceipt
from sqlalchemy import select

from .factories import auth_headers, make_admin, make_order, make_user


async def _receipts(db_session, order_id):
    result = await db_session.execute(
        select(RepairShippingReceipt).where(RepairShippingReceipt.order_id == order_id)
    )
    return list(result.scalars())


async def test_no_tracking_without_reason(client, db_session, settings):
    """reason 없는 순수 '발송 확인'만으로 발송대기→발송확인중."""
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="repair", status="발송대기")

    res = await client.post(
        f"/orders/{order.id}/repair-no-tracking",
        json={},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 200
    assert res.json()["status"] == "발송확인중"

    receipts = await _receipts(db_session, order.id)
    assert len(receipts) == 1
    assert receipts[0].receipt_type == "no_tracking"
    assert receipts[0].reason is None


async def test_no_tracking_with_reason_still_works(client, db_session, settings):
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="repair", status="발송대기")

    res = await client.post(
        f"/orders/{order.id}/repair-no-tracking",
        json={"reason": "lost", "memo": "송장을 잃어버렸어요"},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 200
    assert res.json()["status"] == "발송확인중"
    receipts = await _receipts(db_session, order.id)
    assert receipts[0].reason == "lost"
    assert receipts[0].memo == "송장을 잃어버렸어요"


async def test_tracking_with_memo(client, db_session, settings):
    """송장 등록 시 발송대기→발송중 + memo가 영수증에 저장."""
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="repair", status="발송대기")

    res = await client.post(
        f"/orders/{order.id}/repair-tracking",
        json={"courier_company": "CJ", "tracking_number": " 12345 ", "memo": "문 앞 수령"},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "발송중"
    assert body["courier_company"] == "cj"  # lowercase 정규화
    assert body["tracking_number"] == "12345"  # trim

    receipts = await _receipts(db_session, order.id)
    assert receipts[0].receipt_type == "tracking"
    assert receipts[0].memo == "문 앞 수령"


async def test_tracking_rejected_outside_pending(client, db_session, settings):
    """발송대기가 아니면 등록 불가 (멱등 재제출 방지의 서버측 가드)."""
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="repair", status="발송중")

    res = await client.post(
        f"/orders/{order.id}/repair-tracking",
        json={"courier_company": "cj", "tracking_number": "1"},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 400


async def test_admin_can_force_receive_from_pending(client, db_session, settings):
    """고객 미등록 입고 시 관리자 발송대기→접수 강제 전이 (§9 의도적 추가)."""
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="repair", status="발송대기")

    res = await client.post(
        f"/admin/orders/{order.id}/status",
        json={"new_status": "접수"},
        headers=auth_headers(admin, settings),
    )
    assert res.status_code == 200
    assert res.json() == {"success": True, "previous_status": "발송대기", "new_status": "접수"}
