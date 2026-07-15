from datetime import UTC, datetime

from db.models.commerce import Order, ProductOption
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
    "REFORM_AUTOMATIC_COST": 16000,
    "REFORM_WIDTH_COST": 30000,
    "REFORM_RESTORATION_COST": 30000,
    "REFORM_AUTOMATIC_COMBINED_COST": 40000,
    "REFORM_WIDTH_RESTORATION_COST": 30000,
    "REFORM_SHIPPING_COST": 4500,
    "REFORM_PICKUP_FEE": 5000,
}


async def test_replace_and_get_cart(client, db_session, settings):
    user = await make_user(db_session)
    product = await make_product(db_session, price=15000)
    coupon = await make_coupon(db_session)
    user_coupon = await make_user_coupon(db_session, user, coupon)
    headers = auth_headers(user, settings)
    await seed_pricing(db_session, REFORM_CONSTANTS, category="reform")
    object_key = "uploads/reform_upload/cart-tie.png"
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

    items = [
        {
            "item_id": f"product:{product.id}",
            "item_type": "product",
            "product_id": product.id,
            "quantity": 2,
            "applied_user_coupon_id": str(user_coupon.id),
        },
        {
            "item_id": "reform:abc",
            "item_type": "reform",
            "quantity": 1,
            "reform_data": {
                "tie": {
                    "image": {"object_key": object_key},
                    "automatic": {
                        "mechanism": "zipper",
                        "wearer_height_cm": 175,
                    },
                }
            },
        },
    ]
    res = await client.put("/cart", json={"items": items}, headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 2
    assert body[0]["product"]["price"] == 15000
    assert body[0]["applied_coupon"]["coupon"]["name"] == coupon.name
    assert body[1]["reform_data"]["tie"]["automatic"]["mechanism"] == "zipper"
    assert body[1]["reform_data"]["cost"] == 16000

    # 전체 교체 의미론 — 병합 아님
    res = await client.put("/cart", json={"items": [items[1]]}, headers=headers)
    assert [i["item_id"] for i in res.json()] == ["reform:abc"]

    res = await client.post("/cart/remove", json={"item_ids": ["reform:abc"]}, headers=headers)
    assert res.json() == []


async def test_cart_validation(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    bad_quantity = {
        "items": [{"item_id": "x", "item_type": "product", "product_id": 1, "quantity": 0}]
    }
    assert (await client.put("/cart", json=bad_quantity, headers=headers)).status_code == 400

    product_with_reform = {
        "items": [
            {
                "item_id": "x",
                "item_type": "product",
                "product_id": 1,
                "quantity": 1,
                "reform_data": {"a": 1},
            }
        ]
    }
    res = await client.put("/cart", json=product_with_reform, headers=headers)
    assert res.status_code == 422

    reform_quantity = {
        "items": [
            {
                "item_id": "reform:x",
                "item_type": "reform",
                "quantity": 2,
                "reform_data": {
                    "tie": {
                        "image": {"object_key": "uploads/reform_upload/tie.png"},
                        "restoration": {"memo": ""},
                    }
                },
            }
        ]
    }
    response = await client.put("/cart", json=reform_quantity, headers=headers)
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_quantity"


async def test_deleted_option_remains_visible_and_cannot_be_ordered(client, db_session, settings):
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    product = await make_product(db_session, price=15000)
    option = ProductOption(
        product_id=product.id,
        name="롱",
        additional_price=2000,
        stock=3,
    )
    db_session.add(option)
    await db_session.commit()
    option_id = str(option.id)
    headers = auth_headers(user, settings)
    cart_item = {
        "item_id": f"product:{product.id}:{option_id}",
        "item_type": "product",
        "product_id": product.id,
        "selected_option_id": option_id,
        "quantity": 1,
    }

    saved = await client.put("/cart", json={"items": [cart_item]}, headers=headers)
    assert saved.status_code == 200, saved.text
    assert saved.json()[0]["availability"] == "available"
    assert saved.json()[0]["selected_option_id"] == option_id

    await db_session.delete(option)
    await db_session.commit()

    cart = await client.get("/cart", headers=headers)
    assert cart.status_code == 200, cart.text
    line = cart.json()[0]
    assert line["selected_option_id"] == option_id
    assert line["selected_option"] is None
    assert line["availability"] == "unavailable"
    assert "옵션" in line["blocking_reason"]

    order = await client.post(
        "/orders",
        json={
            "shipping_address_id": str(address.id),
            "items": [cart_item],
        },
        headers=headers,
    )
    assert order.status_code == 404
    assert order.json()["code"] == "option_not_found"
    assert (await db_session.scalars(select(Order).where(Order.user_id == user.id))).all() == []


async def test_product_with_options_requires_an_option(client, db_session, settings):
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    product = await make_product(db_session)
    db_session.add(
        ProductOption(
            product_id=product.id,
            name="롱",
            additional_price=2000,
            stock=3,
        )
    )
    await db_session.commit()
    headers = auth_headers(user, settings)
    cart_item = {
        "item_id": f"product:{product.id}:base",
        "item_type": "product",
        "product_id": product.id,
        "quantity": 1,
    }

    cart = await client.put("/cart", json={"items": [cart_item]}, headers=headers)
    assert cart.status_code == 200, cart.text
    assert cart.json()[0]["availability"] == "unavailable"

    order = await client.post(
        "/orders",
        json={
            "shipping_address_id": str(address.id),
            "items": [cart_item],
        },
        headers=headers,
    )
    assert order.status_code == 400
    assert order.json()["code"] == "option_required"


async def test_guest_reform_image_is_claimed_and_expired_on_remove(client, db_session, settings):
    user = await make_user(db_session)
    await seed_pricing(db_session, REFORM_CONSTANTS, category="reform")
    issued = (
        await client.post(
            "/images/reform-upload-url",
            json={"filename": "tie.png", "content_type": "image/png", "size_bytes": 100},
        )
    ).json()
    completed = await client.post(
        "/images/reform-uploads",
        json={
            "object_key": issued["object_key"],
            "claim_token": issued["claim_token"],
            "size_bytes": 100,
        },
    )
    assert completed.status_code == 201

    headers = auth_headers(user, settings)
    item = {
        "item_id": "reform:guest",
        "item_type": "reform",
        "quantity": 1,
        "reform_data": {
            "tie": {
                "image": {
                    "object_key": issued["object_key"],
                    "claim_token": issued["claim_token"],
                },
                "restoration": {"memo": ""},
            }
        },
    }
    saved = await client.put("/cart", json={"items": [item]}, headers=headers)
    assert saved.status_code == 200, saved.text
    assert "claim_token" not in saved.json()[0]["reform_data"]["tie"]["image"]

    image = await db_session.scalar(select(Image).where(Image.object_key == issued["object_key"]))
    assert image is not None
    await db_session.refresh(image)
    assert image.uploaded_by == user.id
    assert image.claim_token_hash is None
    assert image.expires_at is None

    removed = await client.post(
        "/cart/remove", json={"item_ids": ["reform:guest"]}, headers=headers
    )
    assert removed.status_code == 200
    await db_session.refresh(image)
    assert image.expires_at is not None


async def test_cart_rejects_duplicate_and_oversized_inputs_with_422(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    item = {
        "item_id": "product:bounded",
        "item_type": "product",
        "product_id": 1,
        "quantity": 1,
    }
    payloads = [
        {"items": [item, item]},
        {"items": [{**item, "item_id": "x" * 201}]},
        {"items": [{**item, "quantity": 10_001}]},
        {"items": [{**item, "item_id": f"product:{index}"} for index in range(51)]},
    ]

    for payload in payloads:
        response = await client.put("/cart", json=payload, headers=headers)
        assert response.status_code == 422, response.text

    duplicate_remove = await client.post(
        "/cart/remove",
        json={"item_ids": ["product:bounded", "product:bounded"]},
        headers=headers,
    )
    oversized_remove = await client.post(
        "/cart/remove",
        json={"item_ids": [f"product:{index}" for index in range(51)]},
        headers=headers,
    )
    assert duplicate_remove.status_code == 422
    assert oversized_remove.status_code == 422
