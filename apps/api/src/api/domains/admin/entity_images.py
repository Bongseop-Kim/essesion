"""관리자 이미지 읽기 — 클라이언트 object key 대신 영속 엔티티 관계를 검증한다."""

import uuid
from datetime import UTC, datetime

from db.models.commerce import RepairShippingReceipt
from db.models.images import Image
from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select

from api.db import SessionDep
from api.deps import AdminUser
from api.domains.admin.quote_schemas import SignedReadUrlOut
from api.errors import DomainError, NotFoundError

router = APIRouter(prefix="/admin/repair-shipping-receipts", tags=["admin-images"])

REPAIR_IMAGE_PREFIX = "uploads/repair_shipping_upload/"


class AdminRepairPhotoOut(BaseModel):
    id: uuid.UUID
    content_type: str | None
    size_bytes: int | None
    created_at: datetime


def _photo_keys(receipt: RepairShippingReceipt) -> list[str]:
    keys: list[str] = []
    for value in receipt.photos or []:
        if (
            isinstance(value, dict)
            and isinstance(key := value.get("object_key"), str)
            and key.startswith(REPAIR_IMAGE_PREFIX)
        ):
            keys.append(key)
    return keys


async def _receipt_or_404(session, receipt_id: uuid.UUID) -> RepairShippingReceipt:
    receipt = await session.get(RepairShippingReceipt, receipt_id)
    if receipt is None:
        raise NotFoundError("수선 발송 접수를 찾을 수 없습니다")
    return receipt


@router.get("/{receipt_id}/photos", response_model=list[AdminRepairPhotoOut])
async def list_admin_repair_receipt_photos(
    receipt_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> list[AdminRepairPhotoOut]:
    receipt = await _receipt_or_404(session, receipt_id)
    keys = _photo_keys(receipt)
    if not keys:
        return []
    images = list(
        await session.scalars(
            select(Image).where(
                Image.entity_type == "repair_shipping",
                Image.entity_id == str(receipt.order_id),
                Image.object_key.in_(keys),
                Image.deleted_at.is_(None),
            )
        )
    )
    by_key = {image.object_key: image for image in images}
    return [
        AdminRepairPhotoOut(
            id=image.id,
            content_type=image.content_type,
            size_bytes=image.size_bytes,
            created_at=image.created_at,
        )
        for key in keys
        if (image := by_key.get(key)) is not None
    ]


@router.post("/{receipt_id}/photos/{image_id}/read-url", response_model=SignedReadUrlOut)
async def create_admin_repair_receipt_photo_read_url(
    receipt_id: uuid.UUID,
    image_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> SignedReadUrlOut:
    receipt = await _receipt_or_404(session, receipt_id)
    image = await session.scalar(
        select(Image).where(
            Image.id == image_id,
            Image.entity_type == "repair_shipping",
            Image.entity_id == str(receipt.order_id),
            Image.object_key.in_(_photo_keys(receipt)),
            Image.deleted_at.is_(None),
        )
    )
    if image is None or not image.object_key.startswith(REPAIR_IMAGE_PREFIX):
        raise NotFoundError("수선 발송 사진을 찾을 수 없습니다")
    if image.expires_at is not None and image.expires_at <= datetime.now(UTC):
        raise DomainError("이미지가 만료되었습니다", code="image_expired")
    return SignedReadUrlOut(read_url=await request.app.state.gcs.signed_read_url(image.object_key))
