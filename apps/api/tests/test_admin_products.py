import uuid
from datetime import UTC, datetime

from api.integrations.gcs import DryRunGcsClient, GcsObjectMetadata
from db.models.images import Image
from sqlalchemy import select

from .factories import auth_headers, make_admin, make_product, make_user


def product_body(*, name: str = "관리자 상품", options: list[dict] | None = None) -> dict:
    return {
        "name": name,
        "price": 30000,
        "category": "3fold",
        "color": "navy",
        "pattern": "solid",
        "material": "silk",
        "info": "관리자 상품 테스트",
        "stock": 10,
        "options": options or [],
    }


async def issue_product_image(
    client, headers, *, kind: str = "primary", complete: bool = True
) -> dict:
    issued = await client.post(
        "/admin/products/images/upload-url",
        json={
            "kind": kind,
            "filename": f"{kind}.png",
            "content_type": "image/png",
            "size_bytes": 100,
        },
        headers=headers,
    )
    assert issued.status_code == 200, issued.text
    assert issued.json()["upload_required"] is False
    assert issued.json()["required_headers"]["x-goog-if-generation-match"] == "0"
    if not complete:
        return issued.json()
    completed = await client.post(
        f"/admin/products/images/{issued.json()['upload_id']}/complete",
        headers=headers,
    )
    assert completed.status_code == 200, completed.text
    return completed.json()


async def create_product(client, headers, **kwargs) -> dict:
    primary = await issue_product_image(client, headers)
    body = product_body(**kwargs)
    body["image_upload_id"] = primary["upload_id"]
    response = await client.post("/admin/products", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def test_manager_can_create_and_update_products(client, db_session, settings):
    manager = await make_user(db_session, role="manager")
    headers = auth_headers(manager, settings)

    created = await create_product(client, headers, name="매니저 등록 상품")
    updated = await client.patch(
        f"/admin/products/{created['id']}",
        json={
            "expected_updated_at": created["updated_at"],
            "name": "매니저 수정 상품",
        },
        headers=headers,
    )

    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "매니저 수정 상품"


async def test_admin_product_list_is_paged_and_detail_has_options(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    await create_product(client, headers, name="네이비 관리자 상품")
    target = await create_product(
        client,
        headers,
        name="블랙 관리자 상품",
        options=[{"name": "L", "additional_price": 1000, "stock": 3}],
    )

    page = await client.get(
        "/admin/products",
        params={"sort": "name", "direction": "asc", "limit": 1, "offset": 0},
        headers=headers,
    )
    assert page.status_code == 200
    assert page.json()["total"] == 2
    assert page.json()["limit"] == 1
    assert page.json()["items"][0]["name"] == "네이비 관리자 상품"

    detail = await client.get(f"/admin/products/{target['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["option_count"] == 1
    assert detail.json()["option_stock_total"] == 3
    assert detail.json()["options"][0]["name"] == "L"


async def test_admin_product_list_filters_search_and_kst_created_date(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    previous = await make_product(db_session, name="이전 상품")
    target = await make_product(db_session, name="검색 대상 상품", category="knit")
    later = await make_product(db_session, name="이후 상품")
    previous.code = "OLD-100"
    target.code = "TARGET-100"
    later.code = "LATER-100"
    previous.created_at = datetime(2026, 4, 30, 14, 59, tzinfo=UTC)
    target.created_at = datetime(2026, 4, 30, 15, 0, tzinfo=UTC)
    later.created_at = datetime(2026, 5, 1, 15, 0, tzinfo=UTC)
    await db_session.commit()

    by_name = await client.get("/admin/products", params={"q": "대상 상품"}, headers=headers)
    assert by_name.status_code == 200
    assert [item["id"] for item in by_name.json()["items"]] == [target.id]

    by_code = await client.get("/admin/products", params={"q": "TARGET-100"}, headers=headers)
    assert by_code.status_code == 200
    assert [item["id"] for item in by_code.json()["items"]] == [target.id]

    exact_day = await client.get(
        "/admin/products",
        params={
            "category": "knit",
            "start_date": "2026-05-01",
            "end_date": "2026-05-01",
        },
        headers=headers,
    )
    assert {item["id"] for item in exact_day.json()["items"]} == {target.id}

    open_start = await client.get(
        "/admin/products", params={"start_date": "2026-05-02"}, headers=headers
    )
    assert {item["id"] for item in open_start.json()["items"]} == {later.id}

    open_end = await client.get(
        "/admin/products", params={"end_date": "2026-04-30"}, headers=headers
    )
    assert {item["id"] for item in open_end.json()["items"]} == {previous.id}

    too_short = await client.get("/admin/products", params={"q": "검"}, headers=headers)
    assert too_short.status_code == 400
    assert too_short.json()["code"] == "invalid_search"

    invalid_range = await client.get(
        "/admin/products",
        params={"start_date": "2026-05-02", "end_date": "2026-05-01"},
        headers=headers,
    )
    assert invalid_range.status_code == 400
    assert invalid_range.json()["code"] == "invalid_range"


async def test_option_stock_total_is_unlimited_when_any_option_is_unlimited(
    client, db_session, settings
):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    product = await create_product(
        client,
        headers,
        options=[
            {"name": "재고 옵션", "additional_price": 0, "stock": 4},
            {"name": "무제한 옵션", "additional_price": 0, "stock": None},
        ],
    )

    assert product["option_count"] == 2
    assert product["option_stock_total"] is None


async def test_product_update_preserves_option_ids(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    created = await create_product(
        client,
        headers,
        options=[
            {"name": "L", "additional_price": 1000, "stock": 3},
            {"name": "M", "additional_price": 0, "stock": 4},
        ],
    )
    original_ids = {option["name"]: option["id"] for option in created["options"]}

    response = await client.patch(
        f"/admin/products/{created['id']}",
        json={
            "expected_updated_at": created["updated_at"],
            "name": "수정된 관리자 상품",
            "options": [
                {
                    "id": original_ids["L"],
                    "name": "Large",
                    "additional_price": 2000,
                    "stock": 2,
                },
                {
                    "id": original_ids["M"],
                    "name": "M",
                    "additional_price": 0,
                    "stock": 5,
                },
                {"name": "S", "additional_price": 0, "stock": 1},
            ],
        },
        headers=headers,
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    updated_ids = {option["name"]: option["id"] for option in updated["options"]}
    assert updated_ids["Large"] == original_ids["L"]
    assert updated_ids["M"] == original_ids["M"]
    assert updated_ids["S"] not in original_ids.values()
    assert updated["stock"] is None


async def test_duplicate_option_names_roll_back_product_and_options(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    created = await create_product(
        client,
        headers,
        name="롤백 전 상품",
        options=[
            {"name": "L", "additional_price": 1000, "stock": 3},
            {"name": "M", "additional_price": 0, "stock": 4},
        ],
    )

    response = await client.patch(
        f"/admin/products/{created['id']}",
        json={
            "expected_updated_at": created["updated_at"],
            "name": "저장되면 안 되는 이름",
            "options": [
                {**created["options"][0], "name": "중복"},
                {**created["options"][1], "name": "중복"},
            ],
        },
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_option_name"
    detail = await client.get(f"/admin/products/{created['id']}", headers=headers)
    assert detail.json()["name"] == "롤백 전 상품"
    assert sorted(option["name"] for option in detail.json()["options"]) == ["L", "M"]


async def test_negative_product_and_option_prices_are_mapped(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    created = await create_product(
        client,
        headers,
        options=[{"name": "L", "additional_price": 1000, "stock": 3}],
    )

    negative_product = await client.patch(
        f"/admin/products/{created['id']}",
        json={"expected_updated_at": created["updated_at"], "price": -1},
        headers=headers,
    )
    assert negative_product.status_code == 422
    assert negative_product.json()["code"] == "invalid_product_price"

    negative_option = await client.patch(
        f"/admin/products/{created['id']}",
        json={
            "expected_updated_at": created["updated_at"],
            "options": [{**created["options"][0], "additional_price": -1}],
        },
        headers=headers,
    )
    assert negative_option.status_code == 422
    assert negative_option.json()["code"] == "invalid_option_price"

    detail = await client.get(f"/admin/products/{created['id']}", headers=headers)
    assert detail.json()["price"] == 30000
    assert detail.json()["options"][0]["additional_price"] == 1000


async def test_product_update_rejects_stale_expected_updated_at(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    created = await create_product(client, headers, name="원본 이름")

    first = await client.patch(
        f"/admin/products/{created['id']}",
        json={"expected_updated_at": created["updated_at"], "name": "첫 번째 수정"},
        headers=headers,
    )
    assert first.status_code == 200
    assert first.json()["updated_at"] != created["updated_at"]

    stale = await client.patch(
        f"/admin/products/{created['id']}",
        json={"expected_updated_at": created["updated_at"], "name": "뒤늦은 수정"},
        headers=headers,
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_product"

    detail = await client.get(f"/admin/products/{created['id']}", headers=headers)
    assert detail.json()["name"] == "첫 번째 수정"


async def test_product_images_are_signed_completed_and_linked_atomically(
    client, db_session, settings
):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    primary = await issue_product_image(client, headers)
    detail_one = await issue_product_image(client, headers, kind="detail")
    detail_two = await issue_product_image(client, headers, kind="detail")

    body = product_body(name="이미지 연결 상품")
    body.update(
        {
            "image_upload_id": primary["upload_id"],
            "detail_image_upload_ids": [
                detail_one["upload_id"],
                detail_two["upload_id"],
            ],
        }
    )
    response = await client.post("/admin/products", json=body, headers=headers)

    assert response.status_code == 201, response.text
    product = response.json()
    assert product["image"] == primary["public_url"]
    assert product["detail_images"] == [
        {"url": detail_one["public_url"], "upload_id": detail_one["upload_id"]},
        {"url": detail_two["public_url"], "upload_id": detail_two["upload_id"]},
    ]
    assert product["image_upload_id"] == primary["upload_id"]

    ids = [
        uuid.UUID(primary["upload_id"]),
        uuid.UUID(detail_one["upload_id"]),
        uuid.UUID(detail_two["upload_id"]),
    ]
    rows = {
        str(image.id): image
        for image in await db_session.scalars(select(Image).where(Image.id.in_(ids)))
    }
    assert rows[primary["upload_id"]].entity_type == "product_primary"
    assert rows[primary["upload_id"]].entity_id == str(product["id"])
    assert rows[primary["upload_id"]].expires_at is None
    assert all(
        rows[item["upload_id"]].entity_type == "product_detail" for item in (detail_one, detail_two)
    )


async def test_product_detail_image_ids_support_retain_add_and_remove(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    primary = await issue_product_image(client, headers)
    retained = await issue_product_image(client, headers, kind="detail")
    body = product_body()
    body.update(
        {
            "image_upload_id": primary["upload_id"],
            "detail_image_upload_ids": [retained["upload_id"]],
        }
    )
    created_response = await client.post("/admin/products", json=body, headers=headers)
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    added = await issue_product_image(client, headers, kind="detail")

    add_response = await client.patch(
        f"/admin/products/{created['id']}",
        json={
            "expected_updated_at": created["updated_at"],
            "detail_images": [
                {"upload_id": retained["upload_id"]},
                {"upload_id": added["upload_id"]},
            ],
        },
        headers=headers,
    )
    assert add_response.status_code == 200, add_response.text
    with_added = add_response.json()
    assert with_added["detail_images"] == [
        {"url": retained["public_url"], "upload_id": retained["upload_id"]},
        {"url": added["public_url"], "upload_id": added["upload_id"]},
    ]

    remove_response = await client.patch(
        f"/admin/products/{created['id']}",
        json={
            "expected_updated_at": with_added["updated_at"],
            "detail_images": [{"upload_id": added["upload_id"]}],
        },
        headers=headers,
    )
    assert remove_response.status_code == 200, remove_response.text
    assert remove_response.json()["detail_images"] == [
        {"url": added["public_url"], "upload_id": added["upload_id"]}
    ]
    db_session.expire_all()
    removed = await db_session.get(Image, uuid.UUID(retained["upload_id"]))
    assert removed is not None
    assert removed.entity_type == "product_archived"


async def test_product_image_contract_rejects_arbitrary_unfinished_and_foreign_images(
    client, db_session, settings
):
    admin = await make_admin(db_session)
    other_admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    other_headers = auth_headers(other_admin, settings)

    completed = await issue_product_image(client, headers)
    arbitrary = product_body()
    arbitrary.update(
        {
            "image_upload_id": completed["upload_id"],
            "image": "https://attacker.invalid/product.png",
        }
    )
    arbitrary_response = await client.post("/admin/products", json=arbitrary, headers=headers)
    assert arbitrary_response.status_code == 422

    unfinished = await issue_product_image(client, headers, complete=False)
    unfinished_body = product_body()
    unfinished_body["image_upload_id"] = unfinished["upload_id"]
    unfinished_response = await client.post(
        "/admin/products", json=unfinished_body, headers=headers
    )
    assert unfinished_response.status_code == 409
    assert unfinished_response.json()["code"] == "product_image_not_completed"

    foreign = await issue_product_image(client, other_headers)
    foreign_body = product_body()
    foreign_body["image_upload_id"] = foreign["upload_id"]
    foreign_response = await client.post("/admin/products", json=foreign_body, headers=headers)
    assert foreign_response.status_code == 409
    assert foreign_response.json()["code"] == "product_image_ownership_conflict"


async def test_deleted_product_upload_is_cleaned_from_assets_bucket(
    app, client, db_session, settings
):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    issued = await issue_product_image(client, headers, complete=False)
    deleted = await client.delete(f"/admin/products/images/{issued['upload_id']}", headers=headers)
    assert deleted.status_code == 204

    cleanup = await client.post(
        "/batch/cleanup-images",
        headers={"Authorization": "Bearer test-batch-token"},
    )
    assert cleanup.status_code == 200
    assert cleanup.json()["processed"] == 1
    assert app.state.gcs.deleted_from == [("dry-run-assets", app.state.gcs.deleted[0])]


async def test_product_upload_completion_verifies_assets_object_metadata(
    app, client, db_session, settings
):
    class MetadataGcs(DryRunGcsClient):
        upload_required = True

        def __init__(self) -> None:
            super().__init__()
            self.metadata: GcsObjectMetadata | None = None
            self.metadata_bucket: str | None = None

        async def object_metadata(
            self, object_key: str, *, bucket_name: str | None = None
        ) -> GcsObjectMetadata | None:
            self.metadata_bucket = bucket_name
            return self.metadata

    gcs = MetadataGcs()
    app.state.gcs = gcs
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
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
    assert issued.json()["upload_required"] is True
    upload_id = issued.json()["upload_id"]

    missing = await client.post(f"/admin/products/images/{upload_id}/complete", headers=headers)
    assert missing.status_code == 400
    assert missing.json()["code"] == "upload_not_found"

    gcs.metadata = GcsObjectMetadata(size_bytes=101, content_type="image/png")
    mismatched = await client.post(f"/admin/products/images/{upload_id}/complete", headers=headers)
    assert mismatched.status_code == 422
    assert mismatched.json()["code"] == "invalid_product_image_size"

    gcs.metadata = GcsObjectMetadata(size_bytes=100, content_type="image/png")
    completed = await client.post(f"/admin/products/images/{upload_id}/complete", headers=headers)
    assert completed.status_code == 200, completed.text
    assert gcs.metadata_bucket == "dry-run-assets"
