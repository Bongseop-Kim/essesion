"""클레임 — 생성 가드·상태기계·알림 dedupe (domains.md §4)."""

from api.domains.claims.service import notify_status
from db.models.commerce import Claim, OrderItem

from .factories import auth_headers, make_admin, make_order, make_user


async def _order_with_item(db_session, user, *, status="진행중", order_type="sale", quantity=2):
    order = await make_order(db_session, user, status=status, order_type=order_type)
    item = OrderItem(
        order_id=order.id,
        item_id=f"product:{order.id}",
        item_type="product",
        quantity=quantity,
        unit_price=10000,
    )
    db_session.add(item)
    await db_session.commit()
    return order, item


async def test_create_cancel_claim(client, db_session, settings):
    user = await make_user(db_session)
    order, item = await _order_with_item(db_session, user)
    res = await client.post(
        "/claims",
        json={
            "type": "cancel",
            "order_id": str(order.id),
            "item_id": item.item_id,
            "reason": "change_mind",
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 201, res.text
    assert res.json()["claim_number"].startswith("CLM-")
    assert res.json()["quantity"] == 2  # 기본 = 아이템 수량

    # 주문당 활성 클레임 1건
    dup = await client.post(
        "/claims",
        json={
            "type": "cancel",
            "order_id": str(order.id),
            "item_id": item.item_id,
            "reason": "other",
        },
        headers=auth_headers(user, settings),
    )
    assert dup.status_code == 409
    assert dup.json()["detail"] == "Active claim already exists for this order"


async def test_cancel_claim_status_guard(client, db_session, settings):
    user = await make_user(db_session)
    order, item = await _order_with_item(db_session, user, status="배송완료")
    res = await client.post(
        "/claims",
        json={
            "type": "cancel",
            "order_id": str(order.id),
            "item_id": item.item_id,
            "reason": "change_mind",
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "현재 주문 상태에서는 취소할 수 없습니다"

    # 배송완료면 반품은 가능
    ok = await client.post(
        "/claims",
        json={
            "type": "return",
            "order_id": str(order.id),
            "item_id": item.item_id,
            "reason": "defect",
            "quantity": 1,
        },
        headers=auth_headers(user, settings),
    )
    assert ok.status_code == 201


async def test_customer_cancel_deletes_received_claim(client, db_session, settings):
    user = await make_user(db_session)
    order, item = await _order_with_item(db_session, user)
    claim_id = (
        await client.post(
            "/claims",
            json={
                "type": "cancel",
                "order_id": str(order.id),
                "item_id": item.item_id,
                "reason": "other",
            },
            headers=auth_headers(user, settings),
        )
    ).json()["id"]

    res = await client.delete(f"/claims/{claim_id}", headers=auth_headers(user, settings))
    assert res.status_code == 204
    assert (await client.get("/claims", headers=auth_headers(user, settings))).json() == []


async def test_admin_claim_transitions(client, db_session, settings):
    user = await make_user(db_session)
    admin = await make_admin(db_session)
    order, item = await _order_with_item(db_session, user, status="배송완료")
    claim_id = (
        await client.post(
            "/claims",
            json={
                "type": "exchange",
                "order_id": str(order.id),
                "item_id": item.item_id,
                "reason": "size_mismatch",
            },
            headers=auth_headers(user, settings),
        )
    ).json()["id"]
    headers = auth_headers(admin, settings)

    # 접수 → 처리중은 exchange에 없음
    bad = await client.post(
        f"/admin/claims/{claim_id}/status", json={"new_status": "처리중"}, headers=headers
    )
    assert bad.status_code == 400

    for status in ("수거요청", "수거완료", "재발송", "완료"):
        res = await client.post(
            f"/admin/claims/{claim_id}/status", json={"new_status": status}, headers=headers
        )
        assert res.status_code == 200, (status, res.text)


async def test_admin_reject_and_rollback(client, db_session, settings):
    user = await make_user(db_session)
    admin = await make_admin(db_session)
    order, item = await _order_with_item(db_session, user)
    claim_id = (
        await client.post(
            "/claims",
            json={
                "type": "cancel",
                "order_id": str(order.id),
                "item_id": item.item_id,
                "reason": "other",
            },
            headers=auth_headers(user, settings),
        )
    ).json()["id"]
    headers = auth_headers(admin, settings)

    rejected = await client.post(
        f"/admin/claims/{claim_id}/status", json={"new_status": "거부"}, headers=headers
    )
    assert rejected.status_code == 200

    # 거부 → 접수 롤백은 memo 필수
    no_memo = await client.post(
        f"/admin/claims/{claim_id}/status",
        json={"new_status": "접수", "is_rollback": True},
        headers=headers,
    )
    assert no_memo.status_code == 400

    restored = await client.post(
        f"/admin/claims/{claim_id}/status",
        json={"new_status": "접수", "is_rollback": True, "memo": "오거부 복원"},
        headers=headers,
    )
    assert restored.status_code == 200


async def test_notify_conditions_and_dedupe(app, db_session, settings):
    user = await make_user(db_session, phone="01012341234")
    user.notification_consent = True
    user.notification_enabled = True
    user.phone_verified = True
    order, item = await _order_with_item(db_session, user)
    claim = Claim(
        user_id=user.id,
        order_id=order.id,
        order_item_id=item.id,
        claim_number="CLM-TEST-N01",
        type="cancel",
        status="완료",
        reason="other",
        quantity=1,
    )
    db_session.add(claim)
    await db_session.commit()

    solapi = app.state.solapi
    assert await notify_status(db_session, solapi, settings, claim.id) == "sent"
    assert len(solapi.sent) == 1
    # 같은 상태 재알림 방지
    assert await notify_status(db_session, solapi, settings, claim.id) == "already_sent"
    assert len(solapi.sent) == 1

    # 수신 조건 미충족
    user.notification_enabled = False
    await db_session.commit()
    claim.status = "거부"
    await db_session.commit()
    assert await notify_status(db_session, solapi, settings, claim.id) == "recipient_opted_out"
