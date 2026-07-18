import uuid

from db.models.commerce import OrderItem
from db.models.images import Image

from .factories import (
    auth_headers,
    make_admin,
    make_order,
    make_product,
    make_user,
)

BATCH_HEADERS = {"Authorization": "Bearer test-batch-token"}


async def _staged_photo(client, headers, *, complete=True):
    issued = await client.post(
        "/reviews/photo-uploads",
        json={"filename": "tie.jpg", "content_type": "image/jpeg", "size_bytes": 1234},
        headers=headers,
    )
    assert issued.status_code == 200, issued.text
    if complete:
        completed = await client.post(
            f"/reviews/photo-uploads/{issued.json()['upload_id']}/complete",
            headers=headers,
        )
        assert completed.status_code == 200, completed.text
    return issued.json()["upload_id"]


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


async def test_review_photo_upload_link_and_public_list(app, client, db_session, settings):
    owner = await make_user(db_session, name="김영선")
    order, item, product = await _sale_order_item(db_session, owner)
    headers = auth_headers(owner, settings)

    # DryRun에서도 발급은 assets 버킷 대상 서명 URL 계약을 유지한다.
    issued = await client.post(
        "/reviews/photo-uploads",
        json={"filename": "tie.jpg", "content_type": "image/jpeg", "size_bytes": 1234},
        headers=headers,
    )
    assert issued.status_code == 200, issued.text
    assert issued.json()["upload_required"] is False
    assert issued.json()["required_headers"]["Content-Type"] == "image/jpeg"
    upload_id = issued.json()["upload_id"]

    bad_type = await client.post(
        "/reviews/photo-uploads",
        json={"filename": "tie.gif", "content_type": "image/gif", "size_bytes": 10},
        headers=headers,
    )
    assert bad_type.status_code == 400
    assert bad_type.json()["code"] == "invalid_image_type"

    # 완료 전 링크 시도 → 409
    incomplete = await client.post(
        "/reviews",
        json={
            "order_id": str(order.id),
            "order_item_id": str(item.id),
            "rating": 5,
            "content": "사진 후기",
            "photo_upload_ids": [upload_id],
        },
        headers=headers,
    )
    assert incomplete.status_code == 409
    assert incomplete.json()["code"] == "review_photo_incomplete"

    completed = await client.post(f"/reviews/photo-uploads/{upload_id}/complete", headers=headers)
    assert completed.status_code == 200

    created = await client.post(
        "/reviews",
        json={
            "order_id": str(order.id),
            "order_item_id": str(item.id),
            "rating": 5,
            "content": "사진 후기",
            "photo_upload_ids": [upload_id],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert [photo["upload_id"] for photo in created.json()["photos"]] == [upload_id]
    assert created.json()["photos"][0]["url"].startswith("https://")

    # 공개 목록·단건 조회에 사진 URL 동봉
    listed = await client.get("/reviews", params={"product_id": product.id})
    assert listed.json()["items"][0]["photos"] == created.json()["photos"]
    fetched = await client.get(f"/reviews/{created.json()['id']}")
    assert fetched.json()["photos"] == created.json()["photos"]

    # 링크된 이미지는 영구 보관으로 전환된다.
    image = await db_session.get(Image, uuid.UUID(upload_id))
    assert image is not None
    assert image.entity_type == "review_photo"
    assert image.entity_id == created.json()["id"]
    assert image.expires_at is None


async def test_review_photo_validation_guards(client, db_session, settings):
    owner = await make_user(db_session)
    other = await make_user(db_session)
    order, item, _ = await _sale_order_item(db_session, owner)
    headers = auth_headers(owner, settings)

    def _create_body(photo_ids):
        return {
            "order_id": str(order.id),
            "order_item_id": str(item.id),
            "rating": 5,
            "content": "사진 후기",
            "photo_upload_ids": photo_ids,
        }

    anonymous = await client.post(
        "/reviews/photo-uploads",
        json={"filename": "tie.jpg", "content_type": "image/jpeg", "size_bytes": 10},
    )
    assert anonymous.status_code == 401

    # 타인 스테이징 사용 → 소유권 충돌
    theirs = await _staged_photo(client, auth_headers(other, settings))
    stolen = await client.post("/reviews", json=_create_body([theirs]), headers=headers)
    assert stolen.status_code == 409
    assert stolen.json()["code"] == "ownership_conflict"

    unknown = await client.post("/reviews", json=_create_body([str(uuid.uuid4())]), headers=headers)
    assert unknown.status_code == 409
    assert unknown.json()["code"] == "invalid_review_photo"

    mine = await _staged_photo(client, headers)
    duplicated = await client.post("/reviews", json=_create_body([mine, mine]), headers=headers)
    assert duplicated.status_code == 422
    assert duplicated.json()["code"] == "duplicate_review_photo"

    too_many = await client.post(
        "/reviews",
        json=_create_body([str(uuid.uuid4()) for _ in range(6)]),
        headers=headers,
    )
    assert too_many.status_code == 422

    created = await client.post("/reviews", json=_create_body([mine]), headers=headers)
    assert created.status_code == 201

    # 다른 후기에 이미 링크된 사진 재사용 → 409
    service_order = await make_order(db_session, owner, order_type="repair", status="수선완료")
    reused = await client.post(
        "/reviews",
        json={
            "order_id": str(service_order.id),
            "rating": 4,
            "content": "수선 후기",
            "photo_upload_ids": [mine],
        },
        headers=headers,
    )
    assert reused.status_code == 409
    assert reused.json()["code"] == "invalid_review_photo"


async def test_review_photo_replace_and_delete_cleanup(app, client, db_session, settings):
    owner = await make_user(db_session)
    order = await make_order(db_session, owner, order_type="repair", status="수선완료")
    headers = auth_headers(owner, settings)

    first = await _staged_photo(client, headers)
    created = await client.post(
        "/reviews",
        json={
            "order_id": str(order.id),
            "rating": 5,
            "content": "수선 후기",
            "photo_upload_ids": [first],
        },
        headers=headers,
    )
    assert created.status_code == 201
    review_id = created.json()["id"]

    # 사진 교체 — 제외된 기존 사진은 만료돼 cleanup 대상이 된다.
    second = await _staged_photo(client, headers)
    replaced = await client.patch(
        f"/reviews/{review_id}",
        json={"photo_upload_ids": [second]},
        headers=headers,
    )
    assert replaced.status_code == 200
    assert [photo["upload_id"] for photo in replaced.json()["photos"]] == [second]

    # photo_upload_ids 미지정 수정은 사진을 건드리지 않는다.
    untouched = await client.patch(
        f"/reviews/{review_id}", json={"content": "내용만 수정"}, headers=headers
    )
    assert [photo["upload_id"] for photo in untouched.json()["photos"]] == [second]

    first_image = await db_session.get(Image, uuid.UUID(first))
    second_image = await db_session.get(Image, uuid.UUID(second))
    assert first_image is not None and second_image is not None
    assert first_image.expires_at is not None
    assert second_image.expires_at is None

    # cleanup 배치는 후기 사진을 assets 버킷에서 삭제한다.
    swept = await client.post("/batch/cleanup-images", headers=BATCH_HEADERS)
    assert swept.status_code == 200
    assert ("dry-run-assets", first_image.object_key) in app.state.gcs.deleted_from

    # 후기 삭제 시 남은 사진도 만료된다.
    deleted = await client.delete(f"/reviews/{review_id}", headers=headers)
    assert deleted.status_code == 204
    await db_session.refresh(second_image)
    assert second_image.expires_at is not None
