"""주문 생성 3종 — 수식·재고·쿠폰 규칙 검증 (docs/api-spec/money.md §2~§4)."""

from datetime import UTC, datetime

from db.models.commerce import Order, RepairPickupRequest, UserCoupon
from db.models.images import Image
from sqlalchemy import select

from .factories import (
    auth_headers,
    make_address,
    make_coupon,
    make_product,
    make_user,
    make_user_coupon,
    seed_pricing,
)

REFORM_CONSTANTS = {
    "REFORM_AUTOMATIC_COST": 5000,
    "REFORM_WIDTH_COST": 3000,
    "REFORM_RESTORATION_COST": 3000,
    "REFORM_AUTOMATIC_COMBINED_COST": 8000,
    "REFORM_WIDTH_RESTORATION_COST": 3000,
    "REFORM_SHIPPING_COST": 4500,
    "REFORM_PICKUP_FEE": 5000,
}


async def _setup(db_session, *, stock=None, price=10000):
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    product = await make_product(db_session, price=price, stock=stock)
    return user, address, product


def _product_item(product, quantity=1, coupon_id=None):
    return {
        "item_id": f"product:{product.id}",
        "item_type": "product",
        "product_id": product.id,
        "quantity": quantity,
        "applied_user_coupon_id": str(coupon_id) if coupon_id else None,
    }


async def test_sale_order_totals_and_stock(client, db_session, settings):
    user, address, product = await _setup(db_session, stock=5)
    res = await client.post(
        "/orders",
        json={
            "shipping_address_id": str(address.id),
            "items": [_product_item(product, quantity=2)],
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["total_amount"] == 20000
    assert body["orders"][0]["order_type"] == "sale"
    assert body["orders"][0]["order_number"].startswith("ORD-")

    detail = await client.get(
        f"/orders/{body['orders'][0]['order_id']}", headers=auth_headers(user, settings)
    )
    order = detail.json()
    assert order["status"] == "대기중"
    assert order["shipping_cost"] == 0  # 상품 주문은 항상 무료배송
    assert order["items"][0]["unit_price"] == 10000

    await db_session.refresh(product)
    assert product.stock == 3  # 결제 전 차감


async def test_sale_order_insufficient_stock(client, db_session, settings):
    user, address, product = await _setup(db_session, stock=1)
    res = await client.post(
        "/orders",
        json={
            "shipping_address_id": str(address.id),
            "items": [_product_item(product, quantity=2)],
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Insufficient stock"


async def test_coupon_percentage_with_cap_and_reserve(client, db_session, settings):
    user, address, product = await _setup(db_session)
    coupon = await make_coupon(
        db_session, discount_type="percentage", discount_value=10, max_discount_amount=250
    )
    user_coupon = await make_user_coupon(db_session, user, coupon)

    res = await client.post(
        "/orders",
        json={
            "shipping_address_id": str(address.id),
            "items": [_product_item(product, quantity=3, coupon_id=user_coupon.id)],
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 201
    order_id = res.json()["orders"][0]["order_id"]
    assert res.json()["total_amount"] == 30000 - 250  # 라인 캡 250

    detail = (await client.get(f"/orders/{order_id}", headers=auth_headers(user, settings))).json()
    assert detail["total_discount"] == 250
    assert detail["items"][0]["discount_amount"] == 83  # floor(250/3)
    assert detail["items"][0]["line_discount_amount"] == 250

    reserved = await db_session.scalar(
        select(UserCoupon.status).where(UserCoupon.id == user_coupon.id)
    )
    assert reserved == "reserved"


async def test_fixed_coupon_applies_once_per_line(client, db_session, settings):
    user, address, product = await _setup(db_session)
    coupon = await make_coupon(db_session, discount_type="fixed", discount_value=5000)
    user_coupon = await make_user_coupon(db_session, user, coupon)

    res = await client.post(
        "/orders",
        json={
            "shipping_address_id": str(address.id),
            "items": [_product_item(product, quantity=2, coupon_id=user_coupon.id)],
        },
        headers=auth_headers(user, settings),
    )

    assert res.status_code == 201
    assert res.json()["total_amount"] == 20000 - 5000


async def test_repair_order_with_pickup_splits_group(client, db_session, settings):
    user, address, product = await _setup(db_session)
    await seed_pricing(db_session, REFORM_CONSTANTS, category="reform")
    object_key = "uploads/reform_upload/order-tie.png"
    db_session.add(
        Image(
            object_key=object_key,
            entity_type="reform_upload",
            entity_id=object_key,
            uploaded_by=user.id,
            content_type="image/png",
            size_bytes=100,
            upload_completed_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    res = await client.post(
        "/orders",
        json={
            "shipping_address_id": str(address.id),
            "items": [
                _product_item(product),
                {
                    "item_id": "reform:1",
                    "item_type": "reform",
                    "quantity": 1,
                    "reform_data": {
                        "tie": {
                            "image": {"object_key": object_key},
                            "automatic": {
                                "mechanism": "zipper",
                                "wearer_height_cm": 175,
                            },
                            "width": {"target_width_cm": 8},
                        }
                    },
                },
            ],
            "repair_shipping": {
                "method": "pickup",
                "pickup": {
                    "recipient_name": "김수거",
                    "recipient_phone": "01011112222",
                    "address": "서울시",
                },
            },
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    types = {o["order_type"] for o in body["orders"]}
    assert types == {"sale", "repair"}  # 같은 결제 그룹에 분리 생성
    # repair 합계: (5000+3000) - 0 + 4500(배송) + 5000(수거) = 17500, sale 10000
    assert body["total_amount"] == 27500

    repair_id = next(o["order_id"] for o in body["orders"] if o["order_type"] == "repair")
    pickup = await db_session.scalar(
        select(RepairPickupRequest).where(RepairPickupRequest.order_id == repair_id)
    )
    assert pickup is not None and pickup.pickup_fee == 5000

    orders = (await db_session.scalars(select(Order))).all()
    assert len({o.payment_group_id for o in orders}) == 1


async def test_repair_order_rejects_quantity_above_one(client, db_session, settings):
    user, address, _product = await _setup(db_session)
    object_key = "uploads/reform_upload/order-quantity.png"
    db_session.add(
        Image(
            object_key=object_key,
            entity_type="reform_upload",
            entity_id=object_key,
            uploaded_by=user.id,
            content_type="image/png",
            size_bytes=100,
            upload_completed_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    response = await client.post(
        "/orders",
        json={
            "shipping_address_id": str(address.id),
            "items": [
                {
                    "item_id": "reform:quantity",
                    "item_type": "reform",
                    "quantity": 2,
                    "reform_data": {
                        "tie": {
                            "image": {"object_key": object_key},
                            "restoration": {"memo": ""},
                        }
                    },
                }
            ],
        },
        headers=auth_headers(user, settings),
    )

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_quantity"


async def test_custom_calculate_rules(client, db_session):
    await seed_pricing(
        db_session,
        {
            "START_COST": 50000,
            "SEWING_PER_COST": 3000,
            "AUTO_TIE_COST": 1000,
            "TRIANGLE_STITCH_COST": 500,
            "SIDE_STITCH_COST": 500,
            "BAR_TACK_COST": 300,
            "DIMPLE_COST": 700,
            "SPODERATO_COST": 800,
            "FOLD7_COST": 900,
            "WOOL_INTERLINING_COST": 600,
            "BRAND_LABEL_COST": 200,
            "CARE_LABEL_COST": 100,
            "YARN_DYED_DESIGN_COST": 30000,
            "FABRIC_PRINTING_POLY": 8000,
            "FABRIC_PRINTING_SILK": 10000,
            "FABRIC_YARN_DYED_POLY": 12000,
        },
    )
    # dimple은 AUTO에서만
    res = await client.post(
        "/orders/custom/calculate",
        json={"options": {"dimple": True, "fabric_provided": True}, "quantity": 10},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "딤플은 자동 봉제(AUTO)에서만 선택 가능합니다"

    # 돌려묶기도 AUTO에서만
    res = await client.post(
        "/orders/custom/calculate",
        json={"options": {"turn_knot": True, "fabric_provided": True}, "quantity": 10},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "돌려묶기는 자동 봉제(AUTO)에서만 선택 가능합니다"

    # sewing = (3000+1000+700)*10 + 50000 = 97000, fabric = round(10*10000/4) = 25000
    res = await client.post(
        "/orders/custom/calculate",
        json={
            "options": {
                "tie_type": "AUTO",
                "dimple": True,
                "turn_knot": True,
                "design_type": "PRINTING",
                "fabric_type": "SILK",
            },
            "quantity": 10,
        },
    )
    assert res.status_code == 200
    assert res.json() == {"sewing_cost": 97000, "fabric_cost": 25000, "total_cost": 122000}

    # 폴리 원단 가격 키도 날염·선염 모두 계산 가능해야 한다.
    for design_type, expected_fabric_cost in (("PRINTING", 8000), ("YARN_DYED", 42000)):
        res = await client.post(
            "/orders/custom/calculate",
            json={
                "options": {
                    "design_type": design_type,
                    "fabric_type": "POLY",
                },
                "quantity": 4,
            },
        )
        assert res.status_code == 200
        assert res.json() == {
            "sewing_cost": 62000,
            "fabric_cost": expected_fabric_cost,
            "total_cost": 62000 + expected_fabric_cost,
        }


async def test_custom_order_creates_with_remainder(client, db_session, settings):
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    await seed_pricing(
        db_session,
        {
            "START_COST": 100,
            "SEWING_PER_COST": 3333,
            "AUTO_TIE_COST": 0,
            "TRIANGLE_STITCH_COST": 0,
            "SIDE_STITCH_COST": 0,
            "BAR_TACK_COST": 0,
            "DIMPLE_COST": 0,
            "SPODERATO_COST": 0,
            "FOLD7_COST": 0,
            "WOOL_INTERLINING_COST": 0,
            "BRAND_LABEL_COST": 0,
            "CARE_LABEL_COST": 0,
            "YARN_DYED_DESIGN_COST": 0,
        },
    )
    res = await client.post(
        "/orders/custom",
        json={
            "shipping_address_id": str(address.id),
            "options": {"fabric_provided": True},
            "quantity": 3,
            "reference_images": [{"object_key": "uploads/ref1.png"}],
            "additional_notes": "메모",
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 201, res.text
    # total = 3333*3 + 100 = 10099, base_unit = 3366, remainder = 1
    assert res.json()["total_amount"] == 10099
    detail = (
        await client.get(f"/orders/{res.json()['order_id']}", headers=auth_headers(user, settings))
    ).json()
    item = detail["items"][0]
    assert item["unit_price"] == 3366
    assert item["item_data"]["pricing"]["unit_price_remainder"] == 1
    assert item["item_data"]["reference_images"] == [{"object_key": "uploads/ref1.png"}]


async def test_sample_order_pricing(client, db_session, settings):
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    await seed_pricing(db_session, {"SAMPLE_FABRIC_YARN_DYED_COST": 70000}, category="custom_order")
    res = await client.post(
        "/orders/sample",
        json={
            "shipping_address_id": str(address.id),
            "sample_type": "fabric",
            "options": {"design_type": "YARN_DYED"},
        },
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 201, res.text
    assert res.json()["total_amount"] == 70000


async def test_sample_order_calculate_is_public_and_has_no_order_side_effect(client, db_session):
    await seed_pricing(
        db_session,
        {"SAMPLE_FABRIC_AND_SEWING_PRINTING_COST": 90000},
        category="custom_order",
    )
    res = await client.post(
        "/orders/sample/calculate",
        json={
            "sample_type": "fabric_and_sewing",
            "options": {"design_type": "PRINTING"},
        },
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"total_cost": 90000}

    assert await db_session.scalar(select(Order)) is None


async def test_order_numbering_sequence(client, db_session, settings):
    user, address, product = await _setup(db_session)
    headers = auth_headers(user, settings)
    payload = {"shipping_address_id": str(address.id), "items": [_product_item(product)]}
    first = await client.post("/orders", json=payload, headers=headers)
    second = await client.post("/orders", json=payload, headers=headers)
    n1 = first.json()["orders"][0]["order_number"]
    n2 = second.json()["orders"][0]["order_number"]
    assert n1.endswith("-001") and n2.endswith("-002")
