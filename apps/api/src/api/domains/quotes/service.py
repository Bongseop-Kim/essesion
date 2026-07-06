"""견적 — 생성·상태 전이·이미지 만료 (docs/api-spec/domains.md §7)."""

import json
import uuid
from datetime import UTC, datetime, timedelta

from db.models.auth import User
from db.models.commerce import QuoteRequest, QuoteRequestStatusLog, ShippingAddress
from db.models.images import Image
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.domains.quotes.schemas import QuoteCreateRequest
from api.errors import ConflictError, DomainError, NotFoundError
from api.numbering import generate_number

MAX_OPTIONS_BYTES = 10_000
IMAGE_EXPIRY = timedelta(days=90)

TRANSITIONS: set[tuple[str, str]] = {
    ("요청", "견적발송"),
    ("요청", "종료"),
    ("견적발송", "협의중"),
    ("견적발송", "종료"),
    ("협의중", "확정"),
    ("협의중", "종료"),
}


async def create_quote(session: AsyncSession, user: User, body: QuoteCreateRequest) -> QuoteRequest:
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

    quote = QuoteRequest(
        user_id=user.id,
        quote_number=await generate_number(session, QuoteRequest.quote_number, "QUO"),
        shipping_address_id=body.shipping_address_id,
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
    for img in body.reference_images:
        session.add(
            Image(
                object_key=img.object_key,
                entity_type="quote_request",
                entity_id=str(quote.id),
                uploaded_by=user.id,
            )
        )
    await session.commit()
    await session.refresh(quote)
    return quote


async def admin_update_status(
    session: AsyncSession,
    admin: User,
    quote_id: uuid.UUID,
    *,
    new_status: str,
    quoted_amount: int | None,
    quote_conditions: str | None,
    admin_memo: str | None,
    memo: str | None,
) -> dict:
    quote = await session.scalar(
        select(QuoteRequest).where(QuoteRequest.id == quote_id).with_for_update()
    )
    if quote is None:
        raise NotFoundError("Quote request not found")
    if quote.status == new_status:
        raise ConflictError(f"Status is already {new_status}", code="same_status")
    if (quote.status, new_status) not in TRANSITIONS:
        raise DomainError(
            f'Invalid transition from "{quote.status}" to "{new_status}"',
            code="invalid_transition",
        )
    if quoted_amount is not None and quoted_amount < 0:
        raise DomainError("Quoted amount must be non-negative", code="invalid_amount")

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
    return {"success": True, "previous_status": previous, "new_status": new_status}
