"""수기 주문(무통장·전화 접수) admin CRUD 테스트."""

import uuid

from .factories import auth_headers, make_admin


def manual_order_body(**overrides) -> dict:
    body = {
        "order_date": "2026-07-15",
        "customer_name": "홍길동",
        "phone": "01012345678",
        "address": "서울시 중구 테스트로 1",
        "amount": 30000,
        "shipping_fee": 3000,
        "is_received": True,
        "items": [
            {
                "quantity": 2,
                "automatic": {
                    "mechanism": "zipper",
                    "turn_knot": True,
                    "dimple": True,
                    "total_length_cm": 145,
                },
                "width": {"target_width_cm": 8},
                "note": "지퍼 교체 요청",
            }
        ],
    }
    body.update(overrides)
    return body


async def admin_headers(db_session, settings) -> dict[str, str]:
    admin = await make_admin(db_session)
    return auth_headers(admin, settings)


async def test_manual_order_crud_flow(client, db_session, settings):
    headers = await admin_headers(db_session, settings)

    created = await client.post("/admin/manual-orders", json=manual_order_body(), headers=headers)
    assert created.status_code == 201, created.text
    data = created.json()
    assert data["customer_name"] == "홍길동"
    assert data["is_received"] is True
    assert data["is_paid"] is False
    assert data["items"][0]["automatic"]["total_length_cm"] == 145
    assert data["items"][0]["restoration"] is None

    detail = await client.get(f"/admin/manual-orders/{data['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json() == data

    updated = await client.put(
        f"/admin/manual-orders/{data['id']}",
        json=manual_order_body(
            expected_updated_at=data["updated_at"],
            is_paid=True,
            items=[{"quantity": 1, "restoration": {"memo": "얼룩 제거"}}],
        ),
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["is_paid"] is True
    assert updated.json()["items"][0]["restoration"]["memo"] == "얼룩 제거"
    assert updated.json()["items"][0]["automatic"] is None

    listed = await client.get("/admin/manual-orders", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["total"] == 1

    deleted = await client.delete(f"/admin/manual-orders/{data['id']}", headers=headers)
    assert deleted.status_code == 204
    gone = await client.get(f"/admin/manual-orders/{data['id']}", headers=headers)
    assert gone.status_code == 404


async def test_manual_order_stale_update_conflicts(client, db_session, settings):
    headers = await admin_headers(db_session, settings)
    created = await client.post("/admin/manual-orders", json=manual_order_body(), headers=headers)
    order = created.json()

    first = await client.put(
        f"/admin/manual-orders/{order['id']}",
        json=manual_order_body(expected_updated_at=order["updated_at"], is_paid=True),
        headers=headers,
    )
    assert first.status_code == 200

    stale = await client.put(
        f"/admin/manual-orders/{order['id']}",
        json=manual_order_body(expected_updated_at=order["updated_at"], is_confirmed=True),
        headers=headers,
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_resource"


async def test_manual_order_list_filters(client, db_session, settings):
    headers = await admin_headers(db_session, settings)
    for name, phone, order_date in [
        ("홍길동", "01011112222", "2026-07-01"),
        ("김철수", "01033334444", "2026-07-10"),
    ]:
        response = await client.post(
            "/admin/manual-orders",
            json=manual_order_body(customer_name=name, phone=phone, order_date=order_date),
            headers=headers,
        )
        assert response.status_code == 201

    by_name = await client.get("/admin/manual-orders", params={"q": "길동"}, headers=headers)
    assert [row["customer_name"] for row in by_name.json()["items"]] == ["홍길동"]

    by_phone = await client.get("/admin/manual-orders", params={"q": "3333"}, headers=headers)
    assert [row["customer_name"] for row in by_phone.json()["items"]] == ["김철수"]

    by_date = await client.get(
        "/admin/manual-orders",
        params={"start_date": "2026-07-05", "end_date": "2026-07-31"},
        headers=headers,
    )
    assert [row["customer_name"] for row in by_date.json()["items"]] == ["김철수"]

    missing = await client.get(f"/admin/manual-orders/{uuid.uuid4()}", headers=headers)
    assert missing.status_code == 404


async def test_manual_order_validation(client, db_session, settings):
    headers = await admin_headers(db_session, settings)

    invalid_bodies = [
        manual_order_body(items=[]),  # 품목 없음
        manual_order_body(items=[{"quantity": 1}]),  # 대분류 미선택
        manual_order_body(  # 끈 + 돌려묶기 금지
            items=[
                {
                    "quantity": 1,
                    "automatic": {
                        "mechanism": "string",
                        "turn_knot": True,
                        "total_length_cm": 145,
                    },
                }
            ]
        ),
        manual_order_body(amount=-1),
        manual_order_body(items=[{"quantity": 0, "width": {"target_width_cm": 8}}]),
        manual_order_body(  # 원단 제공이 아닌데 원단 미선택
            items=[{"quantity": 1, "custom": {"fabric_provided": False}}]
        ),
        manual_order_body(  # 수동 봉제 + 딤플 금지
            items=[
                {
                    "quantity": 1,
                    "custom": {
                        "fabric_type": "POLY",
                        "design_type": "PRINTING",
                        "tie_type": "MANUAL",
                        "dimple": True,
                    },
                }
            ]
        ),
        manual_order_body(  # 타이 폭 0 금지
            items=[
                {
                    "quantity": 1,
                    "custom": {
                        "fabric_type": "POLY",
                        "design_type": "PRINTING",
                        "tie_width_cm": 0,
                    },
                }
            ]
        ),
    ]
    for body in invalid_bodies:
        response = await client.post("/admin/manual-orders", json=body, headers=headers)
        assert response.status_code == 422, body


async def test_manual_order_custom_item(client, db_session, settings):
    headers = await admin_headers(db_session, settings)

    body = manual_order_body(
        items=[
            {
                "quantity": 3,
                "custom": {
                    "fabric_provided": False,
                    "fabric_type": "SILK",
                    "design_type": "YARN_DYED",
                    "tie_type": "AUTO",
                    "dimple": True,
                    "turn_knot": True,
                    "size_type": "CHILD",
                    "tie_width_cm": 7.5,
                    "memo": " 로고 자수 ",
                },
            },
            {  # 수선 + 제작 혼합 품목
                "quantity": 1,
                "width": {"target_width_cm": 8},
                "custom": {"fabric_provided": True, "fabric_type": "POLY"},
            },
        ]
    )
    created = await client.post("/admin/manual-orders", json=body, headers=headers)
    assert created.status_code == 201, created.text
    items = created.json()["items"]
    assert items[0]["automatic"] is None
    assert items[0]["custom"]["fabric_type"] == "SILK"
    assert items[0]["custom"]["tie_width_cm"] == 7.5
    assert items[0]["custom"]["memo"] == "로고 자수"
    # 원단 제공이면 원단 선택은 None으로 정규화
    assert items[1]["custom"]["fabric_provided"] is True
    assert items[1]["custom"]["fabric_type"] is None
    assert items[1]["width"]["target_width_cm"] == 8


async def test_dashboard_counts_paid_manual_orders(client, db_session, settings):
    """대시보드 지표·추이에 결제 완료 수기 주문이 합산된다 (미결제는 제외)."""
    headers = await admin_headers(db_session, settings)

    paid = await client.post(
        "/admin/manual-orders",
        json=manual_order_body(
            order_date="2026-07-15", amount=30000, shipping_fee=3000, is_paid=True
        ),
        headers=headers,
    )
    assert paid.status_code == 201
    # 같은 날 미결제 1건 — 매출 인정 기준은 is_paid이므로 어디에도 세어지지 않아야 한다.
    unpaid = await client.post(
        "/admin/manual-orders",
        json=manual_order_body(
            order_date="2026-07-15", amount=99000, shipping_fee=0, is_paid=False
        ),
        headers=headers,
    )
    assert unpaid.status_code == 201
    # 조회 기간 밖 결제 건 — order_date가 매출일이므로 제외되어야 한다.
    outside = await client.post(
        "/admin/manual-orders",
        json=manual_order_body(order_date="2026-07-20", amount=50000, shipping_fee=0, is_paid=True),
        headers=headers,
    )
    assert outside.status_code == 201

    params = {"start_date": "2026-07-15", "end_date": "2026-07-15"}
    overview = await client.get("/admin/dashboard/overview", params=params, headers=headers)
    assert overview.status_code == 200
    summary = overview.json()["summary"]
    # 금액 = amount + shipping_fee (Order.total_price가 배송비를 포함하는 것과 같은 기준)
    assert summary["order_count"] == 1
    assert summary["order_amount"] == 33000

    points = overview.json()["timeseries"]["points"]
    assert [p["day"] for p in points] == ["2026-07-15"]
    assert points[0]["order_count"] == 1
    assert points[0]["order_amount"] == 33000

    # order_type=manual — 수기 주문만 본다. Order 기반 '최근 주문' 표는 비운다.
    only_manual = await client.get(
        "/admin/dashboard/overview",
        params={**params, "order_type": "manual"},
        headers=headers,
    )
    assert only_manual.json()["summary"]["order_amount"] == 33000
    recent = await client.get(
        "/admin/dashboard/recent-orders",
        params={"order_type": "manual"},
        headers=headers,
    )
    assert recent.status_code == 200
    assert recent.json()["items"] == []

    # 특정 Order 유형을 고르면 수기 주문은 빠진다.
    sale_only = await client.get(
        "/admin/dashboard/overview",
        params={**params, "order_type": "sale"},
        headers=headers,
    )
    assert sale_only.json()["summary"]["order_amount"] == 0
