from db.models.commerce import OrderItem

from .factories import (
    auth_headers,
    make_admin,
    make_order,
    make_product,
    make_user,
)


async def _sale_order_item(db_session, user, *, status="배송완료"):
    product = await make_product(db_session)
    order = await make_order(db_session, user, status=status)
    item = OrderItem(
        order_id=order.id,
        item_id=f"product:{product.id}",
        item_type="product",
        product_id=product.id,
        quantity=1,
        unit_price=product.price,
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(item)
    return order, item, product


async def test_review_creation_guards_order_status_and_target(client, db_session, settings):
    owner = await make_user(db_session)
    headers = auth_headers(owner, settings)
    pending, pending_item, _ = await _sale_order_item(db_session, owner, status="진행중")
    not_ready = await client.post(
        "/reviews",
        json={
            "order_id": str(pending.id),
            "order_item_id": str(pending_item.id),
            "rating": 5,
            "content": "좋아요",
        },
        headers=headers,
    )
    assert not_ready.status_code == 409
    assert not_ready.json()["code"] == "review_not_allowed"

    order, item, _ = await _sale_order_item(db_session, owner)
    missing_item = await client.post(
        "/reviews",
        json={"order_id": str(order.id), "rating": 5, "content": "좋아요"},
        headers=headers,
    )
    assert missing_item.status_code == 422

    other_order, other_item, _ = await _sale_order_item(db_session, owner)
    wrong_item = await client.post(
        "/reviews",
        json={
            "order_id": str(order.id),
            "order_item_id": str(other_item.id),
            "rating": 5,
            "content": "좋아요",
        },
        headers=headers,
    )
    assert other_order.id != order.id
    assert wrong_item.status_code == 409
    assert wrong_item.json()["code"] == "invalid_review_target"

    service_order = await make_order(db_session, owner, order_type="repair", status="수선완료")
    service_with_item = await client.post(
        "/reviews",
        json={
            "order_id": str(service_order.id),
            "order_item_id": str(item.id),
            "rating": 4,
            "content": "수선 후기",
        },
        headers=headers,
    )
    assert service_with_item.status_code == 422


async def test_review_public_list_average_masking_and_order_action(client, db_session, settings):
    first_user = await make_user(db_session, name="김영선")
    first_order, first_item, product = await _sale_order_item(db_session, first_user)
    before = await client.get(
        f"/orders/{first_order.id}", headers=auth_headers(first_user, settings)
    )
    assert "write_review" in before.json()["customer_actions"]
    assert before.json()["items"][0]["review_id"] is None

    first = await client.post(
        "/reviews",
        json={
            "order_id": str(first_order.id),
            "order_item_id": str(first_item.id),
            "rating": 5,
            "content": "  아주 만족합니다.  ",
        },
        headers=auth_headers(first_user, settings),
    )
    assert first.status_code == 201, first.text
    assert first.json()["content"] == "아주 만족합니다."
    duplicate = await client.post(
        "/reviews",
        json={
            "order_id": str(first_order.id),
            "order_item_id": str(first_item.id),
            "rating": 4,
            "content": "한 번 더",
        },
        headers=auth_headers(first_user, settings),
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "review_exists"

    second_user = await make_user(db_session, name="이구매")
    second_order = await make_order(db_session, second_user, status="완료")
    second_item = OrderItem(
        order_id=second_order.id,
        item_id=f"product:{product.id}:second",
        item_type="product",
        product_id=product.id,
        quantity=1,
        unit_price=product.price,
    )
    db_session.add(second_item)
    await db_session.commit()
    await db_session.refresh(second_item)
    second = await client.post(
        "/reviews",
        json={
            "order_id": str(second_order.id),
            "order_item_id": str(second_item.id),
            "rating": 3,
            "content": "무난합니다.",
        },
        headers=auth_headers(second_user, settings),
    )
    assert second.status_code == 201

    listed = await client.get("/reviews", params={"product_id": product.id})
    assert listed.status_code == 200
    assert listed.json()["total"] == 2
    assert listed.json()["avg_rating"] == 4
    assert {item["author_name"] for item in listed.json()["items"]} == {
        "김**",
        "이**",
    }

    after = await client.get(
        f"/orders/{first_order.id}", headers=auth_headers(first_user, settings)
    )
    assert "write_review" not in after.json()["customer_actions"]
    assert after.json()["items"][0]["review_id"] == first.json()["id"]
    assert (await client.get("/reviews")).status_code == 422
    assert (
        await client.get("/reviews", params={"product_id": product.id, "order_type": "repair"})
    ).status_code == 422


async def test_service_review_update_delete_and_admin_filter(client, db_session, settings):
    owner = await make_user(db_session, name="박고객")
    order = await make_order(db_session, owner, order_type="sample", status="제작완료")
    headers = auth_headers(owner, settings)
    created = await client.post(
        "/reviews",
        json={"order_id": str(order.id), "rating": 4, "content": "샘플 후기"},
        headers=headers,
    )
    assert created.status_code == 201
    review_id = created.json()["id"]

    fetched = await client.get(f"/reviews/{review_id}")
    assert fetched.status_code == 200
    updated = await client.patch(
        f"/reviews/{review_id}",
        json={"rating": 5, "content": "수정한 후기"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["rating"] == 5

    admin = await make_admin(db_session)
    admin_headers = auth_headers(admin, settings)
    admin_page = await client.get(
        "/admin/reviews",
        params={"order_type": "sample", "rating": 5},
        headers=admin_headers,
    )
    assert admin_page.status_code == 200
    assert admin_page.json()["total"] == 1

    matched = await client.get("/admin/reviews", params={"q": "수정한"}, headers=admin_headers)
    assert matched.status_code == 200
    assert matched.json()["total"] == 1
    unmatched = await client.get(
        "/admin/reviews", params={"q": "없는 검색어"}, headers=admin_headers
    )
    assert unmatched.json()["total"] == 0
    too_short = await client.get("/admin/reviews", params={"q": " 수 "}, headers=admin_headers)
    assert too_short.status_code == 400

    deleted = await client.delete(f"/admin/reviews/{review_id}", headers=admin_headers)
    assert deleted.status_code == 204
    assert (await client.get(f"/reviews/{review_id}")).status_code == 404
