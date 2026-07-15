"""주문 참고 이미지의 스테이징·완료·귀속 규칙."""

import uuid
from datetime import UTC, datetime
from typing import Literal

from db.models.auth import User
from db.models.images import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.errors import ConflictError, DomainError
from api.integrations.gcs import GcsClient

OrderImageKind = Literal["custom_order", "sample_order"]

MAX_ORDER_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_ORDER_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ORDER_UPLOAD_ENTITY_TYPES: dict[OrderImageKind, str] = {
    "custom_order": "custom_order_upload",
    "sample_order": "sample_order_upload",
}


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
