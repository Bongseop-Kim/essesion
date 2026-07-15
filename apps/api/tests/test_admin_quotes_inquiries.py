"""관리자 견적·문의·엔티티 관계 이미지 계약 — 실제 PostgreSQL."""

from db.models.commerce import Inquiry, QuoteRequestStatusLog, RepairShippingReceipt
from db.models.images import Image
from sqlalchemy import select

from .factories import (
    auth_headers,
    make_address,
    make_admin,
    make_order,
    make_product,
    make_user,
)


def _quote_body(address, *, object_key: str | None = None) -> dict:
    return {
        "shipping_address_id": str(address.id),
        "options": {"fabric": "silk", "width": "standard"},
        "quantity": 100,
        "contact_name": "김담당",
        "contact_method": "phone",
        "contact_value": "01012345678",
        "business_name": "테스트상사",
        "reference_images": ([{"object_key": object_key}] if object_key else []),
    }


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


async def test_admin_quote_page_detail_snapshot_stale_audit_and_signed_read(
    client, db_session, settings
):
    customer = await make_user(
        db_session,
        name="견적 고객",
        email="quote-customer@test.local",
        phone="01011112222",
    )
    admin = await make_admin(db_session, email="quote-admin@test.local")
    address = await make_address(db_session, customer)
    customer_headers = auth_headers(customer, settings)
    admin_headers = auth_headers(admin, settings)
    object_key = await _issue_quote_image(client, customer_headers)

    created = await client.post(
        "/quotes",
        json=_quote_body(address, object_key=object_key),
        headers=customer_headers,
    )
    assert created.status_code == 201, created.text
    quote_id = created.json()["id"]
    assert created.json()["shipping_address_snapshot"]["recipient_name"] == "수령인"

    second = await client.post("/quotes", json=_quote_body(address), headers=customer_headers)
    assert second.status_code == 201, second.text

    page = await client.get(
        "/admin/quotes",
        params={"status": "요청", "limit": 1, "offset": 0},
        headers=admin_headers,
    )
    assert page.status_code == 200, page.text
    assert page.json()["total"] == 2
    assert len(page.json()["items"]) == 1
    assert page.json()["items"][0]["customer"]["id"] == str(customer.id)
    assert page.json()["items"][0]["admin_actions"]

    detail = await client.get(f"/admin/quotes/{quote_id}", headers=admin_headers)
    assert detail.status_code == 200, detail.text
    detail_body = detail.json()
    assert detail_body["shipping_address"]["recipient_name"] == "수령인"
    assert detail_body["customer"]["email"] == "quote-customer@test.local"
    assert len(detail_body["images"]) == 1
    assert object_key not in detail.text

    image_id = detail_body["images"][0]["id"]
    signed = await client.post(
        f"/admin/quotes/{quote_id}/images/{image_id}/read-url",
        headers=admin_headers,
    )
    assert signed.status_code == 200, signed.text
    assert signed.json()["read_url"].endswith(object_key)
    unrelated = await client.post(
        f"/admin/quotes/{second.json()['id']}/images/{image_id}/read-url",
        headers=admin_headers,
    )
    assert unrelated.status_code == 404

    await db_session.delete(address)
    await db_session.commit()
    after_address_delete = await client.get(f"/admin/quotes/{quote_id}", headers=admin_headers)
    assert after_address_delete.status_code == 200
    assert after_address_delete.json()["shipping_address_id"] is None
    assert after_address_delete.json()["shipping_address"]["address"] == "서울시 중구 테스트로 1"

    expected_updated_at = after_address_delete.json()["updated_at"]
    transitioned = await client.post(
        f"/admin/quotes/{quote_id}/status",
        json={
            "expected_updated_at": expected_updated_at,
            "new_status": "견적발송",
            "quoted_amount": 250000,
            "quote_conditions": "납기 2주",
            "memo": "견적 발송",
        },
        headers={**admin_headers, "X-Request-ID": "req-admin-quote"},
    )
    assert transitioned.status_code == 200, transitioned.text
    assert transitioned.json()["status"] == "견적발송"
    assert transitioned.json()["quoted_amount"] == 250000
    assert transitioned.json()["status_logs"][0]["actor"]["id"] == str(admin.id)
    assert transitioned.json()["status_logs"][0]["request_id"] == "req-admin-quote"

    stale = await client.post(
        f"/admin/quotes/{quote_id}/status",
        json={"expected_updated_at": expected_updated_at, "new_status": "종료"},
        headers=admin_headers,
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_quote"

    await db_session.rollback()
    log = await db_session.scalar(
        select(QuoteRequestStatusLog).where(QuoteRequestStatusLog.quote_request_id == quote_id)
    )
    assert log is not None
    assert log.changed_by == admin.id
    assert log.request_id == "req-admin-quote"


async def test_admin_inquiry_page_body_search_detail_answer_actor_and_stale(
    client, db_session, settings
):
    customer = await make_user(
        db_session,
        name="문의 고객",
        email="inquiry-customer@test.local",
        phone="01033334444",
    )
    admin = await make_admin(db_session, email="inquiry-admin@test.local")
    admin_id = admin.id
    product = await make_product(db_session, name="문의 상품")
    customer_headers = auth_headers(customer, settings)
    admin_headers = auth_headers(admin, settings)

    first = await client.post(
        "/inquiries",
        json={
            "category": "상품",
            "title": "원단 색상 문의",
            "content": "네이비 재고가 있나요?",
            "product_id": product.id,
        },
        headers=customer_headers,
    )
    second = await client.post(
        "/inquiries",
        json={"category": "일반", "title": "일반 문의", "content": "내용입니다"},
        headers=customer_headers,
    )
    assert first.status_code == 201 and second.status_code == 201
    inquiry_id = first.json()["id"]

    page = await client.get(
        "/admin/inquiries",
        params={"status": "답변대기", "limit": 1},
        headers=admin_headers,
    )
    assert page.status_code == 200, page.text
    assert page.json()["total"] == 2
    assert len(page.json()["items"]) == 1

    searched = await client.post(
        "/admin/inquiries/search",
        json={"q": "원단 색상", "category": "상품", "status": "답변대기"},
        headers=admin_headers,
    )
    assert searched.status_code == 200, searched.text
    assert searched.json()["total"] == 1
    result = searched.json()["items"][0]
    assert result["customer"]["id"] == str(customer.id)
    assert result["product"]["id"] == product.id

    detail = await client.get(f"/admin/inquiries/{inquiry_id}", headers=admin_headers)
    assert detail.status_code == 200
    assert detail.json()["content"] == "네이비 재고가 있나요?"
    expected_updated_at = detail.json()["updated_at"]

    answered = await client.post(
        f"/admin/inquiries/{inquiry_id}/answer",
        json={"answer": "현재 주문 가능합니다.", "expected_updated_at": expected_updated_at},
        headers={**admin_headers, "X-Request-ID": "req-admin-inquiry"},
    )
    assert answered.status_code == 200, answered.text
    assert answered.json()["status"] == "답변완료"
    assert answered.json()["answered_by"] == str(admin_id)
    assert answered.json()["answer_actor"]["id"] == str(admin_id)

    stale = await client.post(
        f"/admin/inquiries/{inquiry_id}/answer",
        json={"answer": "늦은 답변", "expected_updated_at": expected_updated_at},
        headers=admin_headers,
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_inquiry"

    await db_session.rollback()
    inquiry = await db_session.get(Inquiry, inquiry_id)
    assert inquiry is not None
    assert inquiry.answered_by == admin_id
    assert inquiry.answer == "현재 주문 가능합니다."


async def test_admin_repair_receipt_photo_signed_read_requires_receipt_relation(
    client, db_session, settings
):
    customer = await make_user(db_session)
    admin = await make_admin(db_session)
    order = await make_order(db_session, customer, order_type="repair", status="발송확인중")
    object_key = "uploads/repair_shipping_upload/photo.png"
    image = Image(
        object_key=object_key,
        entity_type="repair_shipping",
        entity_id=str(order.id),
        uploaded_by=customer.id,
        content_type="image/png",
        size_bytes=100,
    )
    receipt = RepairShippingReceipt(
        order_id=order.id,
        receipt_type="no_tracking",
        photos=[{"object_key": object_key}],
    )
    unrelated_receipt = RepairShippingReceipt(
        order_id=order.id,
        receipt_type="no_tracking",
        photos=[],
    )
    db_session.add_all([image, receipt, unrelated_receipt])
    await db_session.commit()
    await db_session.refresh(image)
    await db_session.refresh(receipt)
    await db_session.refresh(unrelated_receipt)
    headers = auth_headers(admin, settings)

    photos = await client.get(
        f"/admin/repair-shipping-receipts/{receipt.id}/photos", headers=headers
    )
    assert photos.status_code == 200, photos.text
    assert photos.json() == [
        {
            "id": str(image.id),
            "content_type": "image/png",
            "size_bytes": 100,
            "created_at": image.created_at.isoformat().replace("+00:00", "Z"),
        }
    ]

    signed = await client.post(
        f"/admin/repair-shipping-receipts/{receipt.id}/photos/{image.id}/read-url",
        headers=headers,
    )
    assert signed.status_code == 200, signed.text
    assert signed.json()["read_url"].endswith(object_key)

    unrelated = await client.post(
        f"/admin/repair-shipping-receipts/{unrelated_receipt.id}/photos/{image.id}/read-url",
        headers=headers,
    )
    assert unrelated.status_code == 404
