"""클레임 — 생성 가드·상태기계·알림 dedupe (domains.md §4)."""

from api.domains.claims.service import notify_status
from db.models.commerce import Claim, OrderItem

from .factories import auth_headers, make_address, make_admin, make_order, make_user


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
    assert res.json()["order_number"] == order.order_number
    assert res.json()["item"]["id"] == str(item.id)

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


async def test_claim_guards_match_customer_actions(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    cancelable = {
        "sale": ("대기중", "진행중"),
        "custom": ("대기중", "접수"),
        "sample": ("대기중", "접수"),
        "repair": ("대기중", "발송대기", "발송중", "발송확인중", "수거예정"),
        "token": ("대기중",),
    }

    for order_type, statuses in cancelable.items():
        for status in statuses:
            order, item = await _order_with_item(
                db_session, user, order_type=order_type, status=status
            )
            detail = await client.get(f"/orders/{order.id}", headers=headers)
            assert "claim_cancel" in detail.json()["customer_actions"]

            created = await client.post(
                "/claims",
                json={
                    "type": "cancel",
                    "order_id": str(order.id),
                    "item_id": item.item_id,
                    "reason": "other",
                },
                headers=headers,
            )
            assert created.status_code == 201, (order_type, status, created.text)

            after = await client.get(f"/orders/{order.id}", headers=headers)
            assert not any(
                action.startswith("claim_") for action in after.json()["customer_actions"]
            )

    blocked, blocked_item = await _order_with_item(
        db_session, user, order_type="sale", status="결제중"
    )
    blocked_detail = await client.get(f"/orders/{blocked.id}", headers=headers)
    assert "claim_cancel" not in blocked_detail.json()["customer_actions"]
    blocked_create = await client.post(
        "/claims",
        json={
            "type": "cancel",
            "order_id": str(blocked.id),
            "item_id": blocked_item.item_id,
            "reason": "other",
        },
        headers=headers,
    )
    assert blocked_create.status_code == 400


async def test_return_exchange_are_sale_only(client, db_session, settings):
    user = await make_user(db_session)
    order, item = await _order_with_item(db_session, user, order_type="repair", status="배송완료")
    headers = auth_headers(user, settings)

    detail = await client.get(f"/orders/{order.id}", headers=headers)
    assert "claim_return" not in detail.json()["customer_actions"]
    assert "claim_exchange" not in detail.json()["customer_actions"]

    created = await client.post(
        "/claims",
        json={
            "type": "return",
            "order_id": str(order.id),
            "item_id": item.item_id,
            "reason": "defect",
        },
        headers=headers,
    )
    assert created.status_code == 400


async def test_order_detail_includes_shipping_address(client, db_session, settings):
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    order = await make_order(db_session, user, shipping_address_id=address.id)

    response = await client.get(f"/orders/{order.id}", headers=auth_headers(user, settings))

    assert response.status_code == 200
    assert response.json()["shipping_address"] == {
        "id": str(address.id),
        "recipient_name": "수령인",
        "recipient_phone": "01012345678",
        "postal_code": "04524",
        "address": "서울시 중구 테스트로 1",
        "address_detail": None,
        "delivery_memo": None,
        "delivery_request": None,
    }


async def test_order_list_includes_items(client, db_session, settings):
    user = await make_user(db_session)
    order, item = await _order_with_item(db_session, user)

    response = await client.get("/orders", headers=auth_headers(user, settings))

    assert response.status_code == 200
    listed = next(entry for entry in response.json() if entry["id"] == str(order.id))
    assert [entry["id"] for entry in listed["items"]] == [str(item.id)]


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
