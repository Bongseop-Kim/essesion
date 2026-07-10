import hashlib
import hmac
import uuid
from datetime import UTC, datetime

from db.models.images import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.errors import DomainError
from api.pricing import get_pricing_constants

from .schemas import (
    ReformDataIn,
    ReformDataOut,
    ReformImageIn,
    ReformImageOut,
    ReformPricingOut,
    ReformTieOut,
)

PRICING_KEYS = [
    "REFORM_AUTOMATIC_COST",
    "REFORM_WIDTH_COST",
    "REFORM_RESTORATION_COST",
    "REFORM_AUTOMATIC_COMBINED_COST",
    "REFORM_WIDTH_RESTORATION_COST",
    "REFORM_SHIPPING_COST",
    "REFORM_PICKUP_FEE",
]


async def get_reform_pricing(session: AsyncSession) -> ReformPricingOut:
    values = await get_pricing_constants(session, PRICING_KEYS)
    return ReformPricingOut(
        automatic_cost=values["REFORM_AUTOMATIC_COST"],
        width_cost=values["REFORM_WIDTH_COST"],
        restoration_cost=values["REFORM_RESTORATION_COST"],
        automatic_combined_cost=values["REFORM_AUTOMATIC_COMBINED_COST"],
        width_restoration_cost=values["REFORM_WIDTH_RESTORATION_COST"],
        shipping_cost=values["REFORM_SHIPPING_COST"],
        pickup_fee=values["REFORM_PICKUP_FEE"],
    )


def calculate_reform_cost(data: ReformDataIn, pricing: ReformPricingOut) -> int:
    tie = data.tie
    has_automatic = tie.automatic is not None
    has_width = tie.width is not None
    has_restoration = tie.restoration is not None

    if has_automatic and (has_width or has_restoration):
        return pricing.automatic_combined_cost
    if has_automatic:
        return pricing.automatic_cost
    if has_width and has_restoration:
        return pricing.width_restoration_cost
    if has_width:
        return pricing.width_cost
    return pricing.restoration_cost


def reform_snapshot(data: ReformDataIn, pricing: ReformPricingOut) -> ReformDataOut:
    tie = data.tie
    return ReformDataOut(
        tie=ReformTieOut(
            image=ReformImageOut(object_key=tie.image.object_key),
            automatic=tie.automatic,
            width=tie.width,
            restoration=tie.restoration,
        ),
        cost=calculate_reform_cost(data, pricing),
    )


async def claim_reform_image(
    session: AsyncSession,
    user_id: uuid.UUID,
    image_ref: ReformImageIn,
) -> Image:
    image = await session.scalar(
        select(Image)
        .where(
            Image.entity_type == "reform_upload",
            Image.entity_id == image_ref.object_key,
            Image.deleted_at.is_(None),
        )
        .with_for_update()
    )
    if image is None or image.upload_completed_at is None:
        raise DomainError("수선 사진 업로드를 확인할 수 없습니다", code="invalid_reform_image")

    if image.uploaded_by is None:
        if image.expires_at is not None and image.expires_at <= datetime.now(UTC):
            raise DomainError("수선 사진이 만료되었습니다", code="reform_image_expired")
        if not image_ref.claim_token or not image.claim_token_hash:
            raise DomainError("수선 사진 소유권을 확인할 수 없습니다", code="invalid_image_claim")
        token_hash = hashlib.sha256(image_ref.claim_token.encode()).hexdigest()
        if not hmac.compare_digest(token_hash, image.claim_token_hash):
            raise DomainError("수선 사진 소유권을 확인할 수 없습니다", code="invalid_image_claim")
        image.uploaded_by = user_id
    elif image.uploaded_by != user_id:
        raise DomainError("수선 사진 소유권을 확인할 수 없습니다", code="invalid_image_claim")

    image.claim_token_hash = None
    image.expires_at = None
    return image
