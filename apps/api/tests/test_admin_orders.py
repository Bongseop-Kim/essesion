"""주문 상태기계·송장 (money.md §8)."""

from db.models.commerce import Claim, OrderItem

from .factories import auth_headers, make_admin, make_order, make_user


async def _status_update(client, settings, admin, order_id, body):
    return await client.post(
        f"/admin/orders/{order_id}/status", json=body, headers=auth_headers(admin, settings)
    )


async def test_forward_transition_and_log(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    order = await make_order(db_session, user, status="대기중")

    res = await _status_update(client, settings, admin, order.id, {"new_status": "진행중"})
    assert res.status_code == 200
    assert res.json() == {"success": True, "previous_status": "대기중", "new_status": "진행중"}


async def test_invalid_transition_rejected(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    order = await make_order(db_session, user, status="대기중")
    res = await _status_update(client, settings, admin, order.id, {"new_status": "배송완료"})
    assert res.status_code == 400
    assert "Invalid transition" in res.json()["detail"]


async def test_token_order_cannot_complete_manually(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="token", status="결제중")
    res = await _status_update(client, settings, admin, order.id, {"new_status": "완료"})
    assert res.status_code == 400  # 완료는 결제 confirm 전용

    cancel = await _status_update(client, settings, admin, order.id, {"new_status": "취소"})
    assert cancel.status_code == 200


async def test_rollback_requires_memo(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    order = await make_order(db_session, user, status="진행중")
    res = await _status_update(
        client, settings, admin, order.id, {"new_status": "대기중", "is_rollback": True}
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "롤백 시 사유 입력 필수"

    ok = await _status_update(
        client,
        settings,
        admin,
        order.id,
        {"new_status": "대기중", "is_rollback": True, "memo": "오조작 복구"},
    )
    assert ok.status_code == 200


async def test_active_claim_blocks_status_change(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    order = await make_order(db_session, user, status="진행중")
    item = OrderItem(
        order_id=order.id, item_id="x", item_type="product", quantity=1, unit_price=1000
    )
    db_session.add(item)
    await db_session.flush()
    db_session.add(
        Claim(
            user_id=user.id,
            order_id=order.id,
            order_item_id=item.id,
            claim_number="CLM-TEST-001",
            type="cancel",
            status="접수",
            reason="change_mind",
            quantity=1,
        )
    )
    await db_session.commit()

    res = await _status_update(client, settings, admin, order.id, {"new_status": "배송중"})
    assert res.status_code == 400
    assert res.json()["detail"] == "활성 클레임이 있는 주문은 주문 상태를 직접 변경할 수 없습니다"


async def test_tracking_update_rules(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    order = await make_order(db_session, user, status="진행중")
    headers = auth_headers(admin, settings)

    res = await client.post(
        f"/admin/orders/{order.id}/tracking",
        json={"courier_company": "cj", "tracking_number": "123456"},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["shipped_at"] is not None
    first_shipped = res.json()["shipped_at"]

    # 송장 재입력 — 최초 발송시각 보존
    res = await client.post(
        f"/admin/orders/{order.id}/tracking",
        json={"tracking_number": "999999"},
        headers=headers,
    )
    assert res.json()["shipped_at"] == first_shipped

    # 송장 비우면 shipped_at 리셋
    res = await client.post(
        f"/admin/orders/{order.id}/tracking", json={"tracking_number": ""}, headers=headers
    )
    assert res.json()["shipped_at"] is None

    done = await make_order(db_session, user, status="완료")
    res = await client.post(
        f"/admin/orders/{done.id}/tracking", json={"tracking_number": "1"}, headers=headers
    )
    assert res.status_code == 400
    assert "Tracking cannot be updated" in res.json()["detail"]
