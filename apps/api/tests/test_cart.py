from .factories import auth_headers, make_coupon, make_product, make_user, make_user_coupon


async def test_replace_and_get_cart(client, db_session, settings):
    user = await make_user(db_session)
    product = await make_product(db_session, price=15000)
    coupon = await make_coupon(db_session)
    user_coupon = await make_user_coupon(db_session, user, coupon)
    headers = auth_headers(user, settings)

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
            "reform_data": {"tie": {"hasLengthReform": True}},
        },
    ]
    res = await client.put("/cart", json={"items": items}, headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 2
    assert body[0]["product"]["price"] == 15000
    assert body[0]["applied_coupon"]["coupon"]["name"] == coupon.name
    assert body[1]["reform_data"]["tie"]["hasLengthReform"] is True

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
    assert res.status_code == 400
    assert res.json()["code"] == "invalid_cart_item"
