"""주문 참고 이미지 key laundering 및 관리자 원본 키 노출 회귀."""

import uuid

from api.integrations.gcs import DryRunGcsClient, GcsObjectMetadata
from db.models.commerce import Claim, OrderItem
from db.models.images import Image
from sqlalchemy import select

from .factories import (
    auth_headers,
    make_address,
    make_admin,
    make_order,
    make_user,
    seed_pricing,
)

CUSTOM_PRICING = {
    "START_COST": 100,
    "SEWING_PER_COST": 3000,
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
}


class _MetadataGcs(DryRunGcsClient):
    upload_required = True

    def __init__(self) -> None:
        super().__init__()
        self.metadata: dict[str, GcsObjectMetadata] = {}

    async def object_metadata(
        self, object_key: str, *, bucket_name: str | None = None
    ) -> GcsObjectMetadata | None:
        return self.metadata.get(object_key)


async def _issue_order_image(client, headers, *, kind: str = "custom_order") -> dict:
    response = await client.post(
        "/images/upload-url",
        json={
            "kind": kind,
            "filename": "reference.png",
            "content_type": "image/png",
            "size_bytes": 100,
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["upload_id"] is not None
    return response.json()


async def _complete_order_image(client, headers, upload_id: str):
    return await client.post(f"/images/order-uploads/{upload_id}/complete", headers=headers)


def _custom_body(address_id, upload_ids: list[str]) -> dict:
    return {
        "shipping_address_id": str(address_id),
        "options": {"fabric_provided": True},
        "quantity": 3,
        "reference_images": [{"upload_id": upload_id} for upload_id in upload_ids],
    }


async def test_order_accepts_only_owned_completed_staged_upload_ids(client, db_session, settings):
    owner = await make_user(db_session)
    owner_address = await make_address(db_session, owner)
    other = await make_user(db_session)
    other_address = await make_address(db_session, other)
    await seed_pricing(db_session, CUSTOM_PRICING)
    owner_headers = auth_headers(owner, settings)
    other_headers = auth_headers(other, settings)

    issued = await _issue_order_image(client, owner_headers)
    upload_id = issued["upload_id"]

    incomplete = await client.post(
        "/orders/custom",
        json=_custom_body(owner_address.id, [upload_id]),
        headers=owner_headers,
    )
    assert incomplete.status_code == 400
    assert incomplete.json()["code"] == "order_image_incomplete"

    completed = await _complete_order_image(client, owner_headers, upload_id)
    assert completed.status_code == 200, completed.text
    assert completed.json()["upload_id"] == upload_id

    foreign = await client.post(
        "/orders/custom",
        json=_custom_body(other_address.id, [upload_id]),
        headers=other_headers,
    )
    assert foreign.status_code == 409
    assert foreign.json()["code"] == "ownership_conflict"

    duplicate = await client.post(
        "/orders/custom",
        json=_custom_body(owner_address.id, [upload_id, upload_id]),
        headers=owner_headers,
    )
    assert duplicate.status_code == 400
    assert duplicate.json()["code"] == "duplicate_reference_image"

    arbitrary_id = await client.post(
        "/orders/custom",
        json=_custom_body(owner_address.id, [str(uuid.uuid4())]),
        headers=owner_headers,
    )
    assert arbitrary_id.status_code == 400
    assert arbitrary_id.json()["code"] == "invalid_order_image"

    raw_key = await client.post(
        "/orders/custom",
        json={
            **_custom_body(owner_address.id, []),
            "reference_images": [{"object_key": issued["object_key"]}],
        },
        headers=owner_headers,
    )
    assert raw_key.status_code == 422

    created = await client.post(
        "/orders/custom",
        json=_custom_body(owner_address.id, [upload_id]),
        headers=owner_headers,
    )
    assert created.status_code == 201, created.text
    order_id = created.json()["order_id"]

    image = await db_session.get(Image, uuid.UUID(upload_id))
    assert image is not None
    assert image.entity_type == "custom_order"
    assert image.entity_id == order_id
    assert image.upload_completed_at is not None
    assert image.expires_at is None

    reused = await client.post(
        "/orders/custom",
        json=_custom_body(owner_address.id, [upload_id]),
        headers=owner_headers,
    )
    assert reused.status_code == 400
    assert reused.json()["code"] == "invalid_order_image"


async def test_order_upload_completion_and_creation_revalidate_gcs_metadata(
    app, client, db_session, settings
):
    gcs = _MetadataGcs()
    app.state.gcs = gcs
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    await seed_pricing(db_session, CUSTOM_PRICING)
    headers = auth_headers(user, settings)
    issued = await _issue_order_image(client, headers)
    upload_id = issued["upload_id"]
    object_key = issued["object_key"]

    missing = await _complete_order_image(client, headers, upload_id)
    assert missing.status_code == 400
    assert missing.json()["code"] == "upload_not_found"

    gcs.metadata[object_key] = GcsObjectMetadata(size_bytes=100, content_type="image/jpeg")
    wrong_type = await _complete_order_image(client, headers, upload_id)
    assert wrong_type.status_code == 400
    assert wrong_type.json()["code"] == "invalid_image_type"

    gcs.metadata[object_key] = GcsObjectMetadata(size_bytes=101, content_type="image/png")
    wrong_size = await _complete_order_image(client, headers, upload_id)
    assert wrong_size.status_code == 400
    assert wrong_size.json()["code"] == "invalid_image_size"

    gcs.metadata[object_key] = GcsObjectMetadata(size_bytes=100, content_type="image/png")
    completed = await _complete_order_image(client, headers, upload_id)
    assert completed.status_code == 200, completed.text

    del gcs.metadata[object_key]
    replaced_or_missing = await client.post(
        "/orders/custom",
        json=_custom_body(address.id, [upload_id]),
        headers=headers,
    )
    assert replaced_or_missing.status_code == 400
    assert replaced_or_missing.json()["code"] == "upload_not_found"

    gcs.metadata[object_key] = GcsObjectMetadata(size_bytes=100, content_type="image/png")
    created = await client.post(
        "/orders/custom",
        json=_custom_body(address.id, [upload_id]),
        headers=headers,
    )
    assert created.status_code == 201, created.text


async def test_admin_order_and_claim_hide_private_keys_and_verify_image_relation(
    client, db_session, settings
):
    customer = await make_user(db_session)
    address = await make_address(db_session, customer)
    admin = await make_admin(db_session)
    await seed_pricing(db_session, CUSTOM_PRICING)
    customer_headers = auth_headers(customer, settings)
    admin_headers = auth_headers(admin, settings)
    issued = await _issue_order_image(client, customer_headers)
    upload_id = issued["upload_id"]
    object_key = issued["object_key"]
    assert (await _complete_order_image(client, customer_headers, upload_id)).status_code == 200
    created = await client.post(
        "/orders/custom",
        json=_custom_body(address.id, [upload_id]),
        headers=customer_headers,
    )
    order_id = uuid.UUID(created.json()["order_id"])

    item = await db_session.scalar(select(OrderItem).where(OrderItem.order_id == order_id))
    assert item is not None
    item.item_data = {
        **(item.item_data or {}),
        "reference_images": [{"object_key": object_key, "image_id": upload_id}],
        "legacy": {
            "private_object_key": object_key,
            "asset": object_key,
        },
    }
    claim = Claim(
        user_id=customer.id,
        order_id=order_id,
        order_item_id=item.id,
        claim_number="CLM-IMAGE-SECURITY-001",
        type="cancel",
        status="접수",
        reason="change_mind",
        quantity=1,
    )
    db_session.add(claim)
    await db_session.commit()

    admin_order = await client.get(f"/admin/orders/{order_id}", headers=admin_headers)
    assert admin_order.status_code == 200, admin_order.text
    assert object_key not in admin_order.text
    assert "object_key" not in admin_order.text
    assert admin_order.json()["items"][0]["item_data"]["reference_image_count"] == 1

    admin_claim = await client.get(f"/admin/claims/{claim.id}", headers=admin_headers)
    assert admin_claim.status_code == 200, admin_claim.text
    assert object_key not in admin_claim.text
    assert "object_key" not in admin_claim.text

    images = await client.get(f"/admin/orders/{order_id}/reference-images", headers=admin_headers)
    assert images.status_code == 200, images.text
    assert images.json() == [
        {
            "id": upload_id,
            "content_type": "image/png",
            "size_bytes": 100,
            "created_at": images.json()[0]["created_at"],
        }
    ]
    assert object_key not in images.text

    read_url = await client.post(
        f"/admin/orders/{order_id}/reference-images/{upload_id}/read-url",
        headers=admin_headers,
    )
    assert read_url.status_code == 200, read_url.text
    assert read_url.json()["read_url"].endswith(object_key)

    unrelated_order = await make_order(db_session, customer, order_type="custom")
    laundered_relation = await client.post(
        f"/admin/orders/{unrelated_order.id}/reference-images/{upload_id}/read-url",
        headers=admin_headers,
    )
    assert laundered_relation.status_code == 404
