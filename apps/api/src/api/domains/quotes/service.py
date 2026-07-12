"""견적 — 생성·상태 전이·이미지 만료 (docs/api-spec/domains.md §7)."""

import json
import uuid
from datetime import UTC, datetime, timedelta

from db.models.auth import User
from db.models.commerce import QuoteRequest, QuoteRequestStatusLog, ShippingAddress
from db.models.images import Image
from obs import request_id_var
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.domains.quotes.schemas import QuoteCreateRequest
from api.errors import ConflictError, DomainError, NotFoundError
from api.integrations.gcs import GcsClient
from api.numbering import generate_number

MAX_OPTIONS_BYTES = 10_000
MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
IMAGE_EXPIRY = timedelta(days=90)
QUOTE_IMAGE_PREFIX = "uploads/quote_request/"
QUOTE_UPLOAD_ENTITY_TYPE = "quote_request_upload"

TRANSITIONS: set[tuple[str, str]] = {
    ("요청", "견적발송"),
    ("요청", "종료"),
    ("견적발송", "협의중"),
    ("견적발송", "종료"),
    ("협의중", "확정"),
    ("협의중", "종료"),
}


def _address_snapshot(address: ShippingAddress) -> dict[str, str | bool | None]:
    return {
        "id": str(address.id),
        "recipient_name": address.recipient_name,
        "recipient_phone": address.recipient_phone,
        "postal_code": address.postal_code,
        "address": address.address,
        "address_detail": address.address_detail,
        "is_default": address.is_default,
        "delivery_memo": address.delivery_memo,
        "delivery_request": address.delivery_request,
    }


async def _staged_reference_images(
    session: AsyncSession,
    user: User,
    object_keys: list[str],
    gcs: GcsClient,
) -> list[Image]:
    if len(object_keys) != len(set(object_keys)):
        raise DomainError("참고 이미지가 중복되었습니다", code="duplicate_reference_image")
    if any(not key.startswith(QUOTE_IMAGE_PREFIX) for key in object_keys):
        raise DomainError("유효하지 않은 견적 이미지입니다", code="invalid_quote_image")
    if not object_keys:
        return []

    images = (
        await session.scalars(
            select(Image)
            .where(
                Image.entity_type == QUOTE_UPLOAD_ENTITY_TYPE,
                Image.entity_id.in_(object_keys),
            )
            .with_for_update()
        )
    ).all()
    by_key = {image.object_key: image for image in images}
    now = datetime.now(UTC)

    ordered: list[Image] = []
    for object_key in object_keys:
        image = by_key.get(object_key)
        if image is None:
            raise DomainError("유효하지 않은 견적 이미지입니다", code="invalid_quote_image")
        if image.uploaded_by != user.id:
            raise ConflictError("견적 이미지 소유권이 일치하지 않습니다", code="ownership_conflict")
        if image.deleted_at is not None or (
            image.expires_at is not None and image.expires_at <= now
        ):
            raise DomainError("만료되거나 삭제된 견적 이미지입니다", code="quote_image_expired")

        metadata = await gcs.object_metadata(object_key)
        if gcs.upload_required:
            if metadata is None:
                raise DomainError(
                    "업로드된 견적 이미지를 찾을 수 없습니다", code="upload_not_found"
                )
            if not 0 < metadata.size_bytes <= MAX_REFERENCE_IMAGE_BYTES:
                raise DomainError("이미지는 10MB 이하여야 합니다", code="image_too_large")
            if metadata.content_type != image.content_type:
                raise DomainError("이미지 형식이 일치하지 않습니다", code="invalid_image_type")
            if image.size_bytes is not None and metadata.size_bytes != image.size_bytes:
                raise DomainError("이미지 크기가 일치하지 않습니다", code="invalid_image_size")
            image.size_bytes = metadata.size_bytes
        image.upload_completed_at = now
        ordered.append(image)
    return ordered


async def create_quote(
    session: AsyncSession,
    user: User,
    body: QuoteCreateRequest,
    gcs: GcsClient,
) -> QuoteRequest:
    if body.quantity < 100:
        raise DomainError("Quantity must be 100 or more", code="invalid_quantity")
    if len(json.dumps(body.options).encode()) > MAX_OPTIONS_BYTES:
        raise DomainError("Options payload too large", code="payload_too_large", status=413)
    if not body.contact_name.strip():
        raise DomainError("Contact name is required", code="invalid_contact")
    if not body.contact_value.strip():
        raise DomainError("Contact value is required", code="invalid_contact")
    address = await session.scalar(
        select(ShippingAddress).where(
            ShippingAddress.id == body.shipping_address_id,
            ShippingAddress.user_id == user.id,
        )
    )
    if address is None:
        raise DomainError("Shipping address not found", code="address_not_found", status=404)

    staged_images = await _staged_reference_images(
        session,
        user,
        [image.object_key for image in body.reference_images],
        gcs,
    )

    quote = QuoteRequest(
        user_id=user.id,
        quote_number=await generate_number(session, QuoteRequest.quote_number, "QUO"),
        shipping_address_id=body.shipping_address_id,
        shipping_address_snapshot=_address_snapshot(address),
        options=body.options,
        quantity=body.quantity,
        additional_notes=body.additional_notes,
        contact_name=body.contact_name.strip(),
        business_name=body.business_name.strip(),
        contact_method=body.contact_method,
        contact_value=body.contact_value.strip(),
        status="요청",
        reference_images=[img.model_dump() for img in body.reference_images],
    )
    session.add(quote)
    await session.flush()
    for image in staged_images:
        image.entity_type = "quote_request"
        image.entity_id = str(quote.id)
        image.expires_at = None
        image.deletion_claimed_at = None
    await session.commit()
    await session.refresh(quote)
    return quote


async def admin_update_status(
    session: AsyncSession,
    admin: User,
    quote_id: uuid.UUID,
    *,
    expected_updated_at: datetime,
    new_status: str,
    quoted_amount: int | None,
    quote_conditions: str | None,
    admin_memo: str | None,
    memo: str | None,
) -> QuoteRequest:
    quote = await session.scalar(
        select(QuoteRequest).where(QuoteRequest.id == quote_id).with_for_update()
    )
    if quote is None:
        raise NotFoundError("Quote request not found")
    if quote.updated_at != expected_updated_at:
        raise ConflictError(
            "다른 관리자가 견적을 먼저 변경했습니다. 최신 내용을 다시 확인해 주세요.",
            code="stale_quote",
        )
    if quote.status == new_status:
        raise ConflictError(f"Status is already {new_status}", code="same_status")
    if (quote.status, new_status) not in TRANSITIONS:
        raise DomainError(
            f'Invalid transition from "{quote.status}" to "{new_status}"',
            code="invalid_transition",
        )
    if quoted_amount is not None and quoted_amount < 0:
        raise DomainError("Quoted amount must be non-negative", code="invalid_amount")
    if new_status == "견적발송" and quoted_amount is None and quote.quoted_amount is None:
        raise DomainError(
            "견적발송 시 견적 금액이 필요합니다",
            code="quoted_amount_required",
            status=422,
        )

    previous = quote.status
    quote.status = new_status
    if quoted_amount is not None:
        quote.quoted_amount = quoted_amount
    if quote_conditions is not None:
        quote.quote_conditions = quote_conditions
    if admin_memo is not None:
        quote.admin_memo = admin_memo
    session.add(
        QuoteRequestStatusLog(
            quote_request_id=quote.id,
            changed_by=admin.id,
            previous_status=previous,
            new_status=new_status,
            memo=memo,
            request_id=request_id_var.get() or None,
        )
    )

    # 확정·종료 진입 시 견적 이미지 90일 만료 부여 (구 트리거 → api 로직)
    if new_status in ("확정", "종료"):
        await session.execute(
            update(Image)
            .where(
                Image.entity_type == "quote_request",
                Image.entity_id == str(quote.id),
                Image.expires_at.is_(None),
            )
            .values(expires_at=datetime.now(UTC) + IMAGE_EXPIRY)
        )
    await session.commit()
    await session.refresh(quote)
    return quote
