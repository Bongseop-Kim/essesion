"""주문 참고 이미지의 스테이징·완료·귀속 규칙."""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Literal

from db.models.auth import User
from db.models.commerce import RepairShippingReceipt
from db.models.images import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.errors import ConflictError, DomainError, NotFoundError
from api.integrations.gcs import GcsClient

OrderImageKind = Literal["custom_order", "sample_order"]

MAX_ORDER_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_ORDER_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ORDER_UPLOAD_ENTITY_TYPES: dict[OrderImageKind, str] = {
    "custom_order": "custom_order_upload",
    "sample_order": "sample_order_upload",
}
ORDER_REFERENCE_IMAGE_TYPES = ("custom_order", "sample_order")
ADMIN_ORDER_IMAGE_TYPES = (*ORDER_REFERENCE_IMAGE_TYPES, "reform", "repair_shipping")
REPAIR_IMAGE_PREFIX = "uploads/repair_shipping_upload/"


def order_upload_entity_type(kind: OrderImageKind) -> str:
    return ORDER_UPLOAD_ENTITY_TYPES[kind]


def _validate_staged_image(image: Image, user: User, kind: OrderImageKind) -> None:
    if image.entity_type != order_upload_entity_type(kind):
        raise DomainError("유효하지 않은 주문 이미지입니다", code="invalid_order_image")
    if image.uploaded_by != user.id:
        raise ConflictError("주문 이미지 소유권이 일치하지 않습니다", code="ownership_conflict")
    if image.deleted_at is not None or (
        image.expires_at is not None and image.expires_at <= datetime.now(UTC)
    ):
        raise DomainError("만료되거나 삭제된 주문 이미지입니다", code="order_image_expired")
    if image.content_type not in ALLOWED_ORDER_IMAGE_TYPES:
        raise DomainError("이미지 형식이 일치하지 않습니다", code="invalid_image_type")
    if image.size_bytes is None or not 0 < image.size_bytes <= MAX_ORDER_IMAGE_BYTES:
        raise DomainError("이미지는 10MB 이하여야 합니다", code="image_too_large")


async def _verify_object_metadata(image: Image, gcs: GcsClient) -> None:
    if not gcs.upload_required:
        return
    metadata = await gcs.object_metadata(image.object_key)
    if metadata is None:
        raise DomainError("업로드된 주문 이미지를 찾을 수 없습니다", code="upload_not_found")
    if not 0 < metadata.size_bytes <= MAX_ORDER_IMAGE_BYTES:
        raise DomainError("이미지는 10MB 이하여야 합니다", code="image_too_large")
    if metadata.content_type != image.content_type:
        raise DomainError("이미지 형식이 일치하지 않습니다", code="invalid_image_type")
    if metadata.size_bytes != image.size_bytes:
        raise DomainError("이미지 크기가 일치하지 않습니다", code="invalid_image_size")


async def complete_order_image_upload(
    session: AsyncSession,
    user: User,
    upload_id: uuid.UUID,
    gcs: GcsClient,
) -> Image:
    image = await session.scalar(select(Image).where(Image.id == upload_id).with_for_update())
    if image is None or image.entity_type not in ORDER_UPLOAD_ENTITY_TYPES.values():
        raise DomainError("유효하지 않은 주문 이미지입니다", code="invalid_order_image")
    kind: OrderImageKind = (
        "custom_order" if image.entity_type == "custom_order_upload" else "sample_order"
    )
    _validate_staged_image(image, user, kind)
    await _verify_object_metadata(image, gcs)
    image.upload_completed_at = datetime.now(UTC)
    return image


async def claim_completed_order_images(
    session: AsyncSession,
    user: User,
    kind: OrderImageKind,
    upload_ids: list[uuid.UUID],
    gcs: GcsClient,
) -> list[Image]:
    if len(upload_ids) != len(set(upload_ids)):
        raise DomainError("참고 이미지가 중복되었습니다", code="duplicate_reference_image")
    if not upload_ids:
        return []

    rows = list(
        await session.scalars(select(Image).where(Image.id.in_(upload_ids)).with_for_update())
    )
    by_id = {image.id: image for image in rows}
    ordered: list[Image] = []
    for upload_id in upload_ids:
        image = by_id.get(upload_id)
        if image is None:
            raise DomainError("유효하지 않은 주문 이미지입니다", code="invalid_order_image")
        _validate_staged_image(image, user, kind)
        if image.upload_completed_at is None:
            raise DomainError("완료되지 않은 주문 이미지입니다", code="order_image_incomplete")
        # 완료 URL 발급 뒤 같은 signed PUT URL로 객체가 교체되는 경우도 주문 생성
        # 시점에 다시 잡는다.
        await _verify_object_metadata(image, gcs)
        ordered.append(image)
    return ordered


def link_order_images(images: list[Image], kind: OrderImageKind, order_id: uuid.UUID) -> None:
    for image in images:
        image.entity_type = kind
        image.entity_id = str(order_id)
        image.expires_at = None


async def list_linked_order_images(
    session: AsyncSession,
    order_id: uuid.UUID,
    entity_types: Sequence[str],
) -> list[Image]:
    return list(
        await session.scalars(
            select(Image)
            .where(
                Image.entity_type.in_(entity_types),
                Image.entity_id == str(order_id),
                Image.upload_completed_at.is_not(None),
                Image.deleted_at.is_(None),
            )
            .order_by(Image.created_at.asc(), Image.id.asc())
        )
    )


async def get_linked_order_image(
    session: AsyncSession,
    order_id: uuid.UUID,
    image_id: uuid.UUID,
    entity_types: Sequence[str],
) -> Image:
    image = await session.scalar(
        select(Image).where(
            Image.id == image_id,
            Image.entity_type.in_(entity_types),
            Image.entity_id == str(order_id),
            Image.upload_completed_at.is_not(None),
            Image.deleted_at.is_(None),
        )
    )
    if image is None or (image.expires_at is not None and image.expires_at <= datetime.now(UTC)):
        raise NotFoundError("주문 이미지를 찾을 수 없습니다")
    return image


def repair_receipt_photo_keys(receipt: RepairShippingReceipt) -> list[str]:
    return [
        key
        for value in receipt.photos or []
        if isinstance(value, dict)
        and isinstance(key := value.get("object_key"), str)
        and key.startswith(REPAIR_IMAGE_PREFIX)
    ]


async def list_repair_receipt_photos(
    session: AsyncSession, receipt: RepairShippingReceipt
) -> list[Image]:
    keys = repair_receipt_photo_keys(receipt)
    if not keys:
        return []
    images = list(
        await session.scalars(
            select(Image).where(
                Image.entity_type == "repair_shipping",
                Image.entity_id == str(receipt.order_id),
                Image.object_key.in_(keys),
                Image.upload_completed_at.is_not(None),
                Image.deleted_at.is_(None),
            )
        )
    )
    by_key = {image.object_key: image for image in images}
    return [image for key in keys if (image := by_key.get(key)) is not None]


async def get_repair_receipt_photo(
    session: AsyncSession,
    receipt: RepairShippingReceipt,
    image_id: uuid.UUID,
) -> Image:
    image = await session.scalar(
        select(Image).where(
            Image.id == image_id,
            Image.entity_type == "repair_shipping",
            Image.entity_id == str(receipt.order_id),
            Image.object_key.in_(repair_receipt_photo_keys(receipt)),
            Image.upload_completed_at.is_not(None),
            Image.deleted_at.is_(None),
        )
    )
    if (
        image is None
        or not image.object_key.startswith(REPAIR_IMAGE_PREFIX)
        or (image.expires_at is not None and image.expires_at <= datetime.now(UTC))
    ):
        raise NotFoundError("수선 발송 사진을 찾을 수 없습니다")
    return image
