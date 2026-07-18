"""주문 상태기계·송장 (money.md §8)."""

import uuid
from datetime import UTC, datetime

from db.models.commerce import Claim, Inquiry, OrderItem, OrderStatusLog
from db.models.design import GenerationJob
from db.models.tokens import DesignToken, TokenPurchase

from .factories import (
    auth_headers,
    make_address,
    make_admin,
    make_order,
    make_product,
    make_user,
)


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


async def test_order_list_page_filters_search_and_stable_sort(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session, name="주문 고객")
    same_time = datetime(2026, 5, 1, 3, 0, tzinfo=UTC)
    sale_a = await make_order(db_session, user, created_at=same_time, total_price=2000)
    sale_b = await make_order(db_session, user, created_at=same_time, total_price=1000)
    token = await make_order(
        db_session,
        user,
        order_type="token",
        status="완료",
        total_price=3000,
        created_at=datetime(2026, 4, 30, 15, 0, tzinfo=UTC),  # KST 2026-05-01 00:00
    )
    outside = await make_order(
        db_session,
        user,
        order_type="token",
        status="완료",
        created_at=datetime(2026, 4, 30, 14, 59, tzinfo=UTC),
    )
    headers = auth_headers(admin, settings)

    page = await client.get(
        "/admin/orders",
        params={"limit": 2, "sort": "created_at", "direction": "desc"},
        headers=headers,
    )
    assert page.status_code == 200
    payload = page.json()
    assert {"items", "total", "limit", "offset"} == payload.keys()
    assert payload["total"] == 4
    assert payload["limit"] == 2
    expected_tied_ids = [str(order.id) for order in sorted((sale_a, sale_b), key=lambda x: x.id)]
    assert [item["id"] for item in payload["items"]] == list(reversed(expected_tied_ids))
    assert payload["items"][0]["customer"]["name"] == "주문 고객"
    assert "order_amount" in payload["items"][0]

    filtered = await client.get(
        "/admin/orders",
        params={
            "order_type": "token",
            "status": "완료",
            "start_date": "2026-05-01",
            "end_date": "2026-05-01",
        },
        headers=headers,
    )
    assert filtered.status_code == 200
    assert filtered.json()["limit"] == 20
    assert [item["id"] for item in filtered.json()["items"]] == [str(token.id)]
    assert str(outside.id) not in {item["id"] for item in filtered.json()["items"]}

    open_start = await client.get(
        "/admin/orders",
        params={"start_date": "2026-05-01"},
        headers=headers,
    )
    assert open_start.status_code == 200
    assert {item["id"] for item in open_start.json()["items"]} == {
        str(sale_a.id),
        str(sale_b.id),
        str(token.id),
    }

    open_end = await client.get(
        "/admin/orders",
        params={"end_date": "2026-04-30"},
        headers=headers,
    )
    assert open_end.status_code == 200
    assert {item["id"] for item in open_end.json()["items"]} == {
        str(outside.id),
    }

    searched = await client.get("/admin/orders", params={"q": sale_a.order_number}, headers=headers)
    assert searched.status_code == 200
    assert [item["id"] for item in searched.json()["items"]] == [str(sale_a.id)]

    assert (
        await client.get("/admin/orders", params={"limit": 101}, headers=headers)
    ).status_code == 422
    assert (
        await client.get("/admin/orders", params={"sort": "total_price"}, headers=headers)
    ).status_code == 422
    short_search = await client.get("/admin/orders", params={"q": "x"}, headers=headers)
    assert short_search.status_code == 400
    assert short_search.json()["code"] == "invalid_search"
    invalid_range = await client.get(
        "/admin/orders",
        params={"start_date": "2026-05-02", "end_date": "2026-05-01"},
        headers=headers,
    )
    assert invalid_range.status_code == 400
    assert invalid_range.json()["code"] == "invalid_range"


async def test_dashboard_summary_and_recent_orders(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    sale = await make_order(
        db_session,
        user,
        status="진행중",
        total_price=10000,
        created_at=datetime(2026, 6, 1, 0, 0, tzinfo=UTC),
    )
    token = await make_order(
        db_session,
        user,
        order_type="token",
        status="완료",
        total_price=2500,
        created_at=datetime(2026, 6, 1, 1, 0, tzinfo=UTC),
    )
    # 미결제(대기중)·취소 주문은 매출 지표에서 제외
    await make_order(
        db_session,
        user,
        status="대기중",
        total_price=99999,
        created_at=datetime(2026, 6, 1, 2, 0, tzinfo=UTC),
    )
    await make_order(
        db_session,
        user,
        status="취소",
        total_price=88888,
        created_at=datetime(2026, 6, 1, 3, 0, tzinfo=UTC),
    )
    item = OrderItem(
        order_id=sale.id, item_id="summary-item", item_type="product", quantity=1, unit_price=10000
    )
    db_session.add(item)
    await db_session.flush()
    db_session.add(
        Claim(
            user_id=user.id,
            order_id=sale.id,
            order_item_id=item.id,
            claim_number="CLM-DASHBOARD-001",
            type="cancel",
            status="접수",
            reason="change_mind",
            quantity=1,
        )
    )
    db_session.add_all(
        [
            Inquiry(
                user_id=user.id,
                title="미답변 문의",
                content="내용",
                status="답변대기",
            ),
            Inquiry(
                user_id=user.id,
                title="답변 문의",
                content="내용",
                status="답변완료",
            ),
        ]
    )
    await db_session.commit()
    headers = auth_headers(admin, settings)

    summary = await client.get(
        "/admin/dashboard/summary",
        params={"start_date": "2026-06-01", "end_date": "2026-06-01"},
        headers=headers,
    )
    assert summary.status_code == 200
    assert summary.json()["order_count"] == 2
    assert summary.json()["order_amount"] == 12500
    assert "revenue" not in summary.json()
    assert summary.json()["open_claim_count"] == 1
    assert summary.json()["unanswered_inquiry_count"] == 1
    assert summary.json()["as_of"] is not None

    recent = await client.get(
        "/admin/dashboard/recent-orders",
        params={"order_type": "token", "limit": 1},
        headers=headers,
    )
    assert recent.status_code == 200
    assert recent.json()["total"] == 1
    assert recent.json()["items"][0]["id"] == str(token.id)
    assert recent.json()["as_of"] is not None
    assert (
        await client.get("/admin/dashboard/recent-orders", params={"limit": 21}, headers=headers)
    ).status_code == 422


async def test_admin_order_detail_read_model_and_blocked_actions(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session, name="상세 고객", email="detail@test.local")
    address = await make_address(db_session, user)
    order = await make_order(
        db_session,
        user,
        status="진행중",
        shipping_address_id=address.id,
        shipping_address_snapshot={
            "id": str(address.id),
            "recipient_name": "주문 당시 수령인",
            "recipient_phone": "01000000000",
            "postal_code": "04524",
            "address": "서울시 과거 주소",
            "address_detail": "101호",
            "delivery_memo": "문 앞",
            "delivery_request": None,
        },
    )
    related = await make_order(db_session, user, order_type="repair", status="발송대기")
    payment_group_id = uuid.uuid4()
    order.payment_group_id = payment_group_id
    related.payment_group_id = payment_group_id
    item = OrderItem(
        order_id=order.id,
        item_id="detail-item",
        item_type="product",
        item_data={"product_name": "주문 시점 상품", "option_name": "네이비"},
        quantity=1,
        unit_price=order.total_price,
    )
    db_session.add(item)
    await db_session.flush()
    db_session.add(
        OrderStatusLog(
            order_id=order.id,
            changed_by=admin.id,
            previous_status="대기중",
            new_status="진행중",
            memo="접수 완료",
            is_rollback=False,
        )
    )
    db_session.add(
        Claim(
            user_id=user.id,
            order_id=order.id,
            order_item_id=item.id,
            claim_number="CLM-DETAIL-001",
            type="cancel",
            status="접수",
            reason="change_mind",
            quantity=1,
        )
    )
    await db_session.commit()

    response = await client.get(f"/admin/orders/{order.id}", headers=auth_headers(admin, settings))
    assert response.status_code == 200
    detail = response.json()
    assert detail["customer"]["name"] == "상세 고객"
    assert detail["shipping_address"]["recipient_name"] == "주문 당시 수령인"
    assert detail["items"][0]["item_data"]["product_name"] == "주문 시점 상품"
    assert detail["status_logs"][0]["memo"] == "접수 완료"
    assert detail["active_claim"]["claim_number"] == "CLM-DETAIL-001"
    assert [row["id"] for row in detail["related_orders"]] == [str(related.id)]

    actions = {action["kind"]: action for action in detail["admin_actions"]}
    assert actions["advance"]["target_status"] == "배송중"
    assert actions["advance"]["enabled"] is False
    assert "활성 클레임" in actions["advance"]["blocking_reason"]
    assert actions["rollback"]["target_status"] == "대기중"
    assert actions["rollback"]["requires_memo"] is True
    assert actions["cancel"]["destructive"] is True
    assert actions["update_tracking"]["enabled"] is False
    assert "활성 클레임" in actions["update_tracking"]["blocking_reason"]

    missing = await client.get(
        f"/admin/orders/{uuid.uuid4()}", headers=auth_headers(admin, settings)
    )
    assert missing.status_code == 404


async def test_admin_order_reads_reject_customer(client, db_session, settings):
    customer = await make_user(db_session)
    order = await make_order(db_session, customer)
    headers = auth_headers(customer, settings)

    for path in (
        "/admin/dashboard/summary",
        "/admin/dashboard/timeseries",
        "/admin/dashboard/top-products",
        "/admin/dashboard/recent-orders",
        "/admin/orders",
        f"/admin/orders/{order.id}",
    ):
        response = await client.get(path, headers=headers)
        assert response.status_code == 403


async def test_dashboard_timeseries_kst_buckets_and_zero_fill(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    # 2026-06-10 14:59Z = 6/10 23:59 KST, 15:00Z = 6/11 00:00 KST — 서로 다른 일 버킷
    await make_order(
        db_session,
        user,
        status="진행중",
        total_price=10000,
        created_at=datetime(2026, 6, 10, 14, 59, tzinfo=UTC),
    )
    await make_order(
        db_session,
        user,
        status="완료",
        total_price=3000,
        created_at=datetime(2026, 6, 10, 15, 0, tzinfo=UTC),
    )
    # 미결제 주문은 매출 시계열에서 제외
    await make_order(
        db_session,
        user,
        status="대기중",
        total_price=77777,
        created_at=datetime(2026, 6, 10, 10, 0, tzinfo=UTC),
    )
    # 신규 가입: customer는 집계, admin은 제외
    user.created_at = datetime(2026, 6, 10, 3, 0, tzinfo=UTC)
    admin.created_at = datetime(2026, 6, 10, 3, 0, tzinfo=UTC)
    db_session.add_all(
        [
            GenerationJob(
                user_id=user.id,
                kind="finalize",
                status="succeeded",
                params={},
                created_at=datetime(2026, 6, 10, 4, 0, tzinfo=UTC),
            ),
            GenerationJob(
                user_id=user.id,
                kind="finalize",
                status="failed",
                params={},
                created_at=datetime(2026, 6, 10, 5, 0, tzinfo=UTC),
            ),
            # 토큰 소모 = 차감(-)만 절대값 합산, 지급(+)은 미포함
            DesignToken(
                user_id=user.id,
                amount=100,
                type="purchase",
                token_class="paid",
                created_at=datetime(2026, 6, 10, 6, 0, tzinfo=UTC),
            ),
            DesignToken(
                user_id=user.id,
                amount=-30,
                type="use",
                token_class="paid",
                created_at=datetime(2026, 6, 10, 7, 0, tzinfo=UTC),
            ),
            # 토큰 판매 = 완료만, 대기중 제외
            TokenPurchase(
                user_id=user.id,
                payment_group_id=uuid.uuid4(),
                plan_key="starter",
                token_amount=100,
                price=9900,
                status="완료",
                created_at=datetime(2026, 6, 10, 8, 0, tzinfo=UTC),
            ),
            TokenPurchase(
                user_id=user.id,
                payment_group_id=uuid.uuid4(),
                plan_key="starter",
                token_amount=100,
                price=9900,
                status="대기중",
                created_at=datetime(2026, 6, 10, 9, 0, tzinfo=UTC),
            ),
        ]
    )
    await db_session.commit()

    res = await client.get(
        "/admin/dashboard/timeseries",
        params={"start_date": "2026-06-09", "end_date": "2026-06-11"},
        headers=auth_headers(admin, settings),
    )
    assert res.status_code == 200
    body = res.json()
    assert [p["day"] for p in body["points"]] == ["2026-06-09", "2026-06-10", "2026-06-11"]
    empty, mid, last = body["points"]
    assert empty == {
        "day": "2026-06-09",
        "order_count": 0,
        "order_amount": 0,
        "new_customer_count": 0,
        "generation_total": 0,
        "generation_failed": 0,
        "token_consumed": 0,
        "token_sold": 0,
    }
    assert mid["order_count"] == 1
    assert mid["order_amount"] == 10000
    assert mid["new_customer_count"] == 1  # admin 제외
    assert mid["generation_total"] == 2
    assert mid["generation_failed"] == 1
    assert mid["token_consumed"] == 30
    assert mid["token_sold"] == 100
    assert last["order_count"] == 1
    assert last["order_amount"] == 3000
    assert body["as_of"] is not None


async def test_dashboard_timeseries_order_type_filter_scopes_order_series_only(
    client, db_session, settings
):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    day = datetime(2026, 6, 10, 3, 0, tzinfo=UTC)
    await make_order(
        db_session, user, order_type="token", status="완료", total_price=2500, created_at=day
    )
    user.created_at = day
    await db_session.commit()

    res = await client.get(
        "/admin/dashboard/timeseries",
        params={"start_date": "2026-06-10", "end_date": "2026-06-10", "order_type": "sale"},
        headers=auth_headers(admin, settings),
    )
    assert res.status_code == 200
    point = res.json()["points"][0]
    assert point["order_count"] == 0  # token 주문은 sale 필터에서 제외
    assert point["new_customer_count"] == 1  # 주문 외 시리즈는 필터 무관


async def test_dashboard_timeseries_range_guard(client, db_session, settings):
    admin = await make_admin(db_session)
    res = await client.get(
        "/admin/dashboard/timeseries",
        params={"start_date": "2026-01-01", "end_date": "2026-04-03"},  # 93일
        headers=auth_headers(admin, settings),
    )
    assert res.status_code == 400
    assert res.json()["code"] == "invalid_range"


async def test_dashboard_top_products(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    tie = await make_product(db_session, name="많이 팔린 타이", price=30000)
    scarf = await make_product(db_session, name="덜 팔린 스카프", price=20000)
    in_range = await make_order(
        db_session, user, status="완료", created_at=datetime(2026, 6, 10, 3, 0, tzinfo=UTC)
    )
    out_of_range = await make_order(
        db_session, user, status="완료", created_at=datetime(2026, 7, 1, 3, 0, tzinfo=UTC)
    )
    canceled = await make_order(
        db_session, user, status="취소", created_at=datetime(2026, 6, 10, 4, 0, tzinfo=UTC)
    )
    db_session.add_all(
        [
            OrderItem(
                order_id=in_range.id,
                item_id="top-1",
                item_type="product",
                product_id=tie.id,
                quantity=3,
                unit_price=30000,
            ),
            OrderItem(
                order_id=in_range.id,
                item_id="top-2",
                item_type="product",
                product_id=scarf.id,
                quantity=1,
                unit_price=20000,
            ),
            # product_id 없는 커스텀 항목은 랭킹에서 제외
            OrderItem(
                order_id=in_range.id,
                item_id="top-3",
                item_type="custom",
                quantity=10,
                unit_price=50000,
            ),
            # 기간 밖 주문은 제외
            OrderItem(
                order_id=out_of_range.id,
                item_id="top-4",
                item_type="product",
                product_id=scarf.id,
                quantity=5,
                unit_price=20000,
            ),
            # 취소 주문은 매출 랭킹에서 제외
            OrderItem(
                order_id=canceled.id,
                item_id="top-5",
                item_type="product",
                product_id=scarf.id,
                quantity=7,
                unit_price=20000,
            ),
        ]
    )
    await db_session.commit()
    headers = auth_headers(admin, settings)

    res = await client.get(
        "/admin/dashboard/top-products",
        params={"start_date": "2026-06-01", "end_date": "2026-06-30"},
        headers=headers,
    )
    assert res.status_code == 200
    items = res.json()["items"]
    assert [item["name"] for item in items] == ["많이 팔린 타이", "덜 팔린 스카프"]
    assert items[0] == {
        "product_id": tie.id,
        "name": "많이 팔린 타이",
        "quantity": 3,
        "amount": 90000,
    }
    assert items[1]["quantity"] == 1

    limited = await client.get(
        "/admin/dashboard/top-products",
        params={"start_date": "2026-06-01", "end_date": "2026-06-30", "limit": 1},
        headers=headers,
    )
    assert len(limited.json()["items"]) == 1
    assert (
        await client.get("/admin/dashboard/top-products", params={"limit": 21}, headers=headers)
    ).status_code == 422

    too_wide = await client.get(
        "/admin/dashboard/top-products",
        params={"start_date": "2026-01-01", "end_date": "2026-04-03"},  # 93일
        headers=headers,
    )
    assert too_wide.status_code == 400
    assert too_wide.json()["code"] == "invalid_range"
