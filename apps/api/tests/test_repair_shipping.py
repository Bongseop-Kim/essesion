"""수선 발송 확인 — 송장(선택)·사유(선택)·관리자 강제 접수 (money.md §9 의도적 차이)."""

from datetime import UTC, datetime, timedelta

from db.models.commerce import RepairPickupRequest, RepairShippingReceipt
from db.models.images import Image
from sqlalchemy import select

from .factories import auth_headers, make_admin, make_order, make_user


async def _receipts(db_session, order_id):
    result = await db_session.execute(
        select(RepairShippingReceipt).where(RepairShippingReceipt.order_id == order_id)
    )
    return list(result.scalars())


async def test_no_tracking_without_reason(client, db_session, settings):
    """reason 없는 순수 '발송 확인'만으로 발송대기→발송확인중."""
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="repair", status="발송대기")

    res = await client.post(
        f"/orders/{order.id}/repair-no-tracking",
        json={},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 200
    assert res.json()["status"] == "발송확인중"

    receipts = await _receipts(db_session, order.id)
    assert len(receipts) == 1
    assert receipts[0].receipt_type == "no_tracking"
    assert receipts[0].reason is None


async def test_no_tracking_with_reason_still_works(client, db_session, settings):
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="repair", status="발송대기")

    res = await client.post(
        f"/orders/{order.id}/repair-no-tracking",
        json={"reason": "lost", "memo": "송장을 잃어버렸어요"},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 200
    assert res.json()["status"] == "발송확인중"
    receipts = await _receipts(db_session, order.id)
    assert receipts[0].reason == "lost"
    assert receipts[0].memo == "송장을 잃어버렸어요"


async def test_tracking_with_memo(client, db_session, settings):
    """송장 등록 시 발송대기→발송중 + memo가 영수증에 저장."""
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="repair", status="발송대기")

    res = await client.post(
        f"/orders/{order.id}/repair-tracking",
        json={"courier_company": "CJ", "tracking_number": " 12345 ", "memo": "문 앞 수령"},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "발송중"
    assert body["courier_company"] == "cj"  # lowercase 정규화
    assert body["tracking_number"] == "12345"  # trim

    receipts = await _receipts(db_session, order.id)
    assert receipts[0].receipt_type == "tracking"
    assert receipts[0].memo == "문 앞 수령"


async def test_tracking_rejected_outside_pending(client, db_session, settings):
    """발송대기가 아니면 등록 불가 (멱등 재제출 방지의 서버측 가드)."""
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="repair", status="발송중")

    res = await client.post(
        f"/orders/{order.id}/repair-tracking",
        json={"courier_company": "cj", "tracking_number": "1"},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 400


async def test_admin_can_force_receive_from_pending(client, db_session, settings):
    """고객 미등록 입고 시 관리자 발송대기→접수 강제 전이 (§9 의도적 추가)."""
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    order = await make_order(db_session, user, order_type="repair", status="발송대기")

    res = await client.post(
        f"/admin/orders/{order.id}/status",
        json={"new_status": "접수"},
        headers=auth_headers(admin, settings),
    )
    assert res.status_code == 200
    assert res.json() == {"success": True, "previous_status": "발송대기", "new_status": "접수"}


async def test_repair_detail_and_photos_are_visible_only_through_order_relation(
    client, db_session, settings
):
    owner = await make_user(db_session)
    other = await make_user(db_session)
    admin = await make_admin(db_session)
    order = await make_order(db_session, owner, order_type="repair", status="발송확인중")
    pickup = RepairPickupRequest(
        order_id=order.id,
        recipient_name="수거 고객",
        recipient_phone="01012345678",
        postal_code="04524",
        address="서울시 중구",
        detail_address="101호",
        pickup_fee=5000,
    )
    reform_key = "uploads/reform_upload/tie.png"
    receipt_key = "uploads/repair_shipping_upload/receipt.png"
    expired_reform_key = "uploads/reform_upload/expired.png"
    expired_receipt_key = "uploads/repair_shipping_upload/expired.png"
    reform_image = Image(
        object_key=reform_key,
        entity_type="reform",
        entity_id=str(order.id),
        uploaded_by=owner.id,
        content_type="image/png",
        size_bytes=100,
        upload_completed_at=datetime.now(UTC),
    )
    receipt_image = Image(
        object_key=receipt_key,
        entity_type="repair_shipping",
        entity_id=str(order.id),
        uploaded_by=owner.id,
        content_type="image/png",
        size_bytes=200,
        upload_completed_at=datetime.now(UTC),
    )
    expired_reform_image = Image(
        object_key=expired_reform_key,
        entity_type="reform",
        entity_id=str(order.id),
        uploaded_by=owner.id,
        content_type="image/png",
        size_bytes=300,
        upload_completed_at=datetime.now(UTC),
        expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    expired_receipt_image = Image(
        object_key=expired_receipt_key,
        entity_type="repair_shipping",
        entity_id=str(order.id),
        uploaded_by=owner.id,
        content_type="image/png",
        size_bytes=400,
        upload_completed_at=datetime.now(UTC),
        expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    receipt = RepairShippingReceipt(
        order_id=order.id,
        receipt_type="no_tracking",
        reason="lost",
        memo="송장 분실",
        photos=[
            {"object_key": receipt_key},
            {"object_key": expired_receipt_key},
        ],
    )
    db_session.add_all(
        [
            pickup,
            reform_image,
            receipt_image,
            expired_reform_image,
            expired_receipt_image,
            receipt,
        ]
    )
    await db_session.commit()
    await db_session.refresh(receipt_image)
    await db_session.refresh(receipt)

    owner_headers = auth_headers(owner, settings)
    detail = await client.get(f"/orders/{order.id}", headers=owner_headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["repair_pickup"]["recipient_name"] == "수거 고객"
    assert detail.json()["repair_receipts"][0] == {
        "id": str(receipt.id),
        "receipt_type": "no_tracking",
        "reason": "lost",
        "memo": "송장 분실",
        "photo_count": 2,
        "created_at": detail.json()["repair_receipts"][0]["created_at"],
    }
    assert receipt_key not in detail.text
    assert expired_receipt_key not in detail.text

    photos = await client.get(
        f"/orders/{order.id}/repair-shipping-receipts/{receipt.id}/photos",
        headers=owner_headers,
    )
    assert photos.status_code == 200, photos.text
    assert [photo["id"] for photo in photos.json()] == [str(receipt_image.id)]
    assert receipt_key not in photos.text
    assert expired_receipt_key not in photos.text

    signed = await client.post(
        f"/orders/{order.id}/repair-shipping-receipts/{receipt.id}/photos/{receipt_image.id}/read-url",
        headers=owner_headers,
    )
    assert signed.status_code == 200, signed.text
    assert signed.json()["read_url"].endswith(receipt_key)

    expired_signed = await client.post(
        f"/orders/{order.id}/repair-shipping-receipts/{receipt.id}/photos/{expired_receipt_image.id}/read-url",
        headers=owner_headers,
    )
    assert expired_signed.status_code == 404

    forbidden = await client.get(
        f"/orders/{order.id}/repair-shipping-receipts/{receipt.id}/photos",
        headers=auth_headers(other, settings),
    )
    assert forbidden.status_code == 403

    admin_detail = await client.get(
        f"/admin/orders/{order.id}", headers=auth_headers(admin, settings)
    )
    assert admin_detail.status_code == 200, admin_detail.text
    assert admin_detail.json()["repair_pickup"]["recipient_phone"] == "01012345678"
    assert admin_detail.json()["repair_receipts"][0]["photo_count"] == 2

    admin_images = await client.get(
        f"/admin/orders/{order.id}/reference-images",
        headers=auth_headers(admin, settings),
    )
    assert admin_images.status_code == 200, admin_images.text
    assert {image["id"] for image in admin_images.json()} == {str(reform_image.id)}
    assert reform_key not in admin_images.text
    assert receipt_key not in admin_images.text
    assert expired_reform_key not in admin_images.text
    assert expired_receipt_key not in admin_images.text
