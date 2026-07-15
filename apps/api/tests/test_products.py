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


async def test_sort_popular_and_limit(client, db_session, settings):
    low = await make_product(db_session, name="저가", price=10000)
    await make_product(db_session, name="고가", price=90000)
    # 저가 상품에 찜 2개 → popular 정렬에서 앞서야 함
    for _ in range(2):
        user = await make_user(db_session)
        await client.put(f"/products/{low.id}/like", headers=auth_headers(user, settings))

    popular = await client.get("/products?sort=popular")
    assert [p["name"] for p in popular.json()] == ["저가", "고가"]

    price_high = await client.get("/products?sort=price-high")
    assert [p["name"] for p in price_high.json()] == ["고가", "저가"]

    limited = await client.get("/products?sort=popular&limit=1")
    assert [p["name"] for p in limited.json()] == ["저가"]

    next_page = await client.get("/products?sort=popular&limit=1&offset=1")
    assert [p["name"] for p in next_page.json()] == ["고가"]


async def test_list_products_filter_limit_and_offset(client, db_session):
    await make_product(db_session, name="네이비 1", category="3fold", color="navy")
    await make_product(db_session, name="블랙 제외", category="3fold", color="black")
    await make_product(db_session, name="네이비 2", category="3fold", color="navy")
    await make_product(db_session, name="네이비 3", category="3fold", color="navy")

    first_page = await client.get("/products?color=navy&sort=latest&limit=2&offset=0")
    second_page = await client.get("/products?color=navy&sort=latest&limit=2&offset=2")

    assert [p["name"] for p in first_page.json()] == ["네이비 3", "네이비 2"]
    assert [p["name"] for p in second_page.json()] == ["네이비 1"]


async def test_list_products_searches_name_with_literal_wildcards(client, db_session):
    await make_product(db_session, name="Navy Silk Tie")
    await make_product(db_session, name="Navy_100% Tie")
    await make_product(db_session, name="Black Tie")

    search = await client.get("/products", params={"q": "navy", "limit": 20})
    literal = await client.get("/products", params={"q": "_100%"})

    assert [p["name"] for p in search.json()] == ["Navy_100% Tie", "Navy Silk Tie"]
    assert [p["name"] for p in literal.json()] == ["Navy_100% Tie"]


async def test_admin_create_product_auto_code(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)

    async def _primary_upload_id() -> str:
        issued = await client.post(
            "/admin/products/images/upload-url",
            json={
                "kind": "primary",
                "filename": "primary.png",
                "content_type": "image/png",
                "size_bytes": 100,
            },
            headers=headers,
        )
        assert issued.status_code == 200, issued.text
        upload_id = issued.json()["upload_id"]
        completed = await client.post(
            f"/admin/products/images/{upload_id}/complete", headers=headers
        )
        assert completed.status_code == 200, completed.text
        return upload_id

    body = {
        "name": "자동코드",
        "price": 20000,
        "category": "knit",
        "color": "navy",
        "pattern": "solid",
        "material": "silk",
        "info": "테스트",
    }
    first = await client.post(
        "/admin/products",
        json={**body, "image_upload_id": await _primary_upload_id()},
        headers=headers,
    )
    second = await client.post(
        "/admin/products",
        json={**body, "image_upload_id": await _primary_upload_id()},
        headers=headers,
    )
    assert first.status_code == 201 and second.status_code == 201
    code1, code2 = first.json()["code"], second.json()["code"]
    assert code1.startswith("KN-") and code1.endswith("-001")
    assert code2.endswith("-002")


async def test_admin_product_update_forces_product_stock_null(client, db_session, settings):
    admin = await make_admin(db_session)
    product = await make_product(db_session, stock=10)
    headers = auth_headers(admin, settings)
    res = await client.patch(
        f"/admin/products/{product.id}",
        json={
            "expected_updated_at": product.updated_at.isoformat(),
            "options": [{"name": "L", "additional_price": 1000, "stock": 5}],
        },
        headers=headers,
    )
    assert res.status_code == 200
    detail = await client.get(f"/products/{product.id}")
    assert detail.json()["stock"] is None
    assert detail.json()["options"][0]["name"] == "L"
