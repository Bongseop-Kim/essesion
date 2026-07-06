"""견적 — 생성 검증·전이·이미지 만료 (domains.md §7)."""

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
        "reference_images": [{"object_key": "uploads/quote/ref.png"}],
    }
    body.update(overrides)
    return body


async def test_create_quote_and_validation(client, db_session, settings):
    user = await make_user(db_session)
    address = await make_address(db_session, user)
    headers = auth_headers(user, settings)

    too_few = await client.post("/quotes", json=_quote_body(address, quantity=99), headers=headers)
    assert too_few.status_code == 400
    assert too_few.json()["detail"] == "Quantity must be 100 or more"

    res = await client.post("/quotes", json=_quote_body(address), headers=headers)
    assert res.status_code == 201, res.text
    assert res.json()["quote_number"].startswith("QUO-")
    assert res.json()["status"] == "요청"

    image = await db_session.scalar(select(Image).where(Image.entity_type == "quote_request"))
    assert image is not None and image.expires_at is None


async def test_admin_quote_transition_and_image_expiry(client, db_session, settings):
    user = await make_user(db_session)
    admin = await make_admin(db_session)
    address = await make_address(db_session, user)
    quote_id = (
        await client.post(
            "/quotes", json=_quote_body(address), headers=auth_headers(user, settings)
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
