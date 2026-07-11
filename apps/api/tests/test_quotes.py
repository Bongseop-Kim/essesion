"""견적 — 생성 검증·전이·이미지 만료 (domains.md §7)."""

from datetime import UTC, datetime, timedelta

from api.domains.quotes.service import MAX_REFERENCE_IMAGE_BYTES
from api.integrations.gcs import DryRunGcsClient, GcsObjectMetadata
from db.models.images import Image
from sqlalchemy import select

from .factories import auth_headers, make_address, make_admin, make_user


def _quote_body(address, **overrides):
    body = {
        "shipping_address_id": str(address.id),
        "options": {"fabric": "silk"},
        "quantity": 100,
        "contact_name": "김담당",
        "contact_method": "phone",
        "contact_value": "01012345678",
        "reference_images": [],
    }
    body.update(overrides)
    return body


async def _issue_quote_image(client, headers) -> str:
    response = await client.post(
        "/images/upload-url",
        json={
            "kind": "quote_request",
            "filename": "reference.png",
            "content_type": "image/png",
            "size_bytes": 100,
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["object_key"]


class _MetadataGcs(DryRunGcsClient):
    upload_required = True

    def __init__(self) -> None:
        super().__init__()
        self.metadata: dict[str, GcsObjectMetadata] = {}

    async def object_metadata(self, object_key: str) -> GcsObjectMetadata | None:
        return self.metadata.get(object_key)


async def test_create_quote_and_validation(client, db_session, settings):
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    headers = auth_headers(user, settings)

    too_few = await client.post("/quotes", json=_quote_body(address, quantity=99), headers=headers)
    assert too_few.status_code == 400
    assert too_few.json()["detail"] == "Quantity must be 100 or more"

    too_many_images = await client.post(
        "/quotes",
        json=_quote_body(
            address,
            reference_images=[
                {"object_key": f"uploads/quote_request/{index:032d}.png"} for index in range(6)
            ],
        ),
        headers=headers,
    )
    assert too_many_images.status_code == 422

    object_key = await _issue_quote_image(client, headers)
    res = await client.post(
        "/quotes",
        json=_quote_body(address, reference_images=[{"object_key": object_key}]),
        headers=headers,
    )
    assert res.status_code == 201, res.text
    assert res.json()["quote_number"].startswith("QUO-")
    assert res.json()["status"] == "요청"

    images = (await db_session.scalars(select(Image).where(Image.object_key == object_key))).all()
    assert len(images) == 1
    image = images[0]
    assert image.entity_type == "quote_request"
    assert image.entity_id == res.json()["id"]
    assert image is not None and image.expires_at is None
    assert image.upload_completed_at is not None

    read_url = await client.post(
        "/images/read-url",
        json={"object_key": image.object_key},
        headers=headers,
    )
    assert read_url.status_code == 200
    assert read_url.json()["read_url"]

    image.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()
    expired = await client.post(
        "/images/read-url",
        json={"object_key": image.object_key},
        headers=headers,
    )
    assert expired.status_code == 400
    assert expired.json()["code"] == "image_expired"


async def test_quote_rejects_unissued_and_foreign_images(client, db_session, settings):
    owner = await make_user(db_session)
    other = await make_user(db_session)
    other_address = await make_address(db_session, other)
    owner_headers = auth_headers(owner, settings)
    other_headers = auth_headers(other, settings)
    object_key = await _issue_quote_image(client, owner_headers)

    foreign = await client.post(
        "/quotes",
        json=_quote_body(
            other_address,
            reference_images=[{"object_key": object_key}],
        ),
        headers=other_headers,
    )
    assert foreign.status_code == 409
    assert foreign.json()["code"] == "ownership_conflict"

    unissued = await client.post(
        "/quotes",
        json=_quote_body(
            other_address,
            reference_images=[
                {"object_key": "uploads/quote_request/00000000000000000000000000000000.png"}
            ],
        ),
        headers=other_headers,
    )
    assert unissued.status_code == 400
    assert unissued.json()["code"] == "invalid_quote_image"

    wrong_kind = await client.post(
        "/quotes",
        json=_quote_body(
            other_address,
            reference_images=[{"object_key": "uploads/custom_order/reference.png"}],
        ),
        headers=other_headers,
    )
    assert wrong_kind.status_code == 400
    assert wrong_kind.json()["code"] == "invalid_quote_image"


async def test_quote_requires_uploaded_object_metadata(client, app, db_session, settings):
    app.state.gcs = _MetadataGcs()
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    headers = auth_headers(user, settings)
    object_key = await _issue_quote_image(client, headers)
    body = _quote_body(address, reference_images=[{"object_key": object_key}])

    missing = await client.post("/quotes", json=body, headers=headers)
    assert missing.status_code == 400
    assert missing.json()["code"] == "upload_not_found"

    app.state.gcs.metadata[object_key] = GcsObjectMetadata(
        size_bytes=100,
        content_type="image/jpeg",
    )
    mismatched = await client.post("/quotes", json=body, headers=headers)
    assert mismatched.status_code == 400
    assert mismatched.json()["code"] == "invalid_image_type"

    app.state.gcs.metadata[object_key] = GcsObjectMetadata(
        size_bytes=100,
        content_type="image/png",
    )
    created = await client.post("/quotes", json=body, headers=headers)
    assert created.status_code == 201, created.text


async def test_quote_rejects_duplicate_expired_and_oversized_images(
    client, app, db_session, settings
):
    app.state.gcs = _MetadataGcs()
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    headers = auth_headers(user, settings)
    object_key = await _issue_quote_image(client, headers)

    duplicate = await client.post(
        "/quotes",
        json=_quote_body(
            address,
            reference_images=[{"object_key": object_key}, {"object_key": object_key}],
        ),
        headers=headers,
    )
    assert duplicate.status_code == 400
    assert duplicate.json()["code"] == "duplicate_reference_image"

    image = await db_session.scalar(select(Image).where(Image.object_key == object_key))
    assert image is not None
    image.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()
    expired = await client.post(
        "/quotes",
        json=_quote_body(address, reference_images=[{"object_key": object_key}]),
        headers=headers,
    )
    assert expired.status_code == 400
    assert expired.json()["code"] == "quote_image_expired"

    image.expires_at = datetime.now(UTC) + timedelta(hours=1)
    await db_session.commit()
    app.state.gcs.metadata[object_key] = GcsObjectMetadata(
        size_bytes=MAX_REFERENCE_IMAGE_BYTES + 1,
        content_type="image/png",
    )
    oversized = await client.post(
        "/quotes",
        json=_quote_body(address, reference_images=[{"object_key": object_key}]),
        headers=headers,
    )
    assert oversized.status_code == 400
    assert oversized.json()["code"] == "image_too_large"


async def test_admin_quote_transition_and_image_expiry(client, db_session, settings):
    user = await make_user(db_session)
    admin = await make_admin(db_session)
    address = await make_address(db_session, user)
    user_headers = auth_headers(user, settings)
    object_key = await _issue_quote_image(client, user_headers)
    quote_id = (
        await client.post(
            "/quotes",
            json=_quote_body(address, reference_images=[{"object_key": object_key}]),
            headers=user_headers,
        )
    ).json()["id"]
    headers = auth_headers(admin, settings)

    invalid = await client.post(
        f"/admin/quotes/{quote_id}/status", json={"new_status": "확정"}, headers=headers
    )
    assert invalid.status_code == 400  # 요청→확정 불가

    sent = await client.post(
        f"/admin/quotes/{quote_id}/status",
        json={"new_status": "견적발송", "quoted_amount": 1500000},
        headers=headers,
    )
    assert sent.status_code == 200

    ended = await client.post(
        f"/admin/quotes/{quote_id}/status", json={"new_status": "종료"}, headers=headers
    )
    assert ended.status_code == 200

    # 종료 진입 시 견적 이미지 +90일 만료 부여
    image = await db_session.scalar(select(Image).where(Image.entity_type == "quote_request"))
    assert image.expires_at is not None
