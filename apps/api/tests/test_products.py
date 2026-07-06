from .factories import auth_headers, make_admin, make_product, make_user


async def test_public_list_and_detail(client, db_session):
    product = await make_product(db_session, name="네이비 타이")
    res = await client.get("/products")
    assert res.status_code == 200
    assert [p["name"] for p in res.json()] == ["네이비 타이"]
    assert res.json()[0]["is_liked"] is False

    detail = await client.get(f"/products/{product.id}")
    assert detail.status_code == 200
    assert detail.json()["likes"] == 0


async def test_like_unlike_and_is_liked(client, db_session, settings):
    product = await make_product(db_session)
    user = await make_user(db_session)
    headers = auth_headers(user, settings)

    assert (await client.put(f"/products/{product.id}/like", headers=headers)).status_code == 204
    # 멱등 — 중복 찜은 no-op
    assert (await client.put(f"/products/{product.id}/like", headers=headers)).status_code == 204

    detail = await client.get(f"/products/{product.id}", headers=headers)
    assert detail.json()["likes"] == 1 and detail.json()["is_liked"] is True

    anonymous = await client.get(f"/products/{product.id}")
    assert anonymous.json()["likes"] == 1 and anonymous.json()["is_liked"] is False

    assert (await client.delete(f"/products/{product.id}/like", headers=headers)).status_code == 204
    detail = await client.get(f"/products/{product.id}", headers=headers)
    assert detail.json()["likes"] == 0


async def test_admin_create_product_auto_code(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    body = {
        "name": "자동코드",
        "price": 20000,
        "image": "https://img.test/i.png",
        "category": "knit",
        "color": "navy",
        "pattern": "solid",
        "material": "silk",
        "info": "테스트",
    }
    first = await client.post("/admin/products", json=body, headers=headers)
    second = await client.post("/admin/products", json=body, headers=headers)
    assert first.status_code == 201 and second.status_code == 201
    code1, code2 = first.json()["code"], second.json()["code"]
    assert code1.startswith("KN-") and code1.endswith("-001")
    assert code2.endswith("-002")


async def test_replace_options_forces_product_stock_null(client, db_session, settings):
    admin = await make_admin(db_session)
    product = await make_product(db_session, stock=10)
    headers = auth_headers(admin, settings)
    res = await client.put(
        f"/admin/products/{product.id}/options",
        json=[{"name": "L", "additional_price": 1000, "stock": 5}],
        headers=headers,
    )
    assert res.status_code == 200
    detail = await client.get(f"/products/{product.id}")
    assert detail.json()["stock"] is None
    assert detail.json()["options"][0]["name"] == "L"
