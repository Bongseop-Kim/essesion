"""관리자 이미지 읽기 — 클라이언트 object key 대신 영속 엔티티 관계를 검증한다."""

import uuid
from datetime import datetime

from db.models.commerce import RepairShippingReceipt
from fastapi import APIRouter, Request
from pydantic import BaseModel

from api.db import SessionDep
from api.deps import AdminUser
from api.domains.admin.quote_schemas import SignedReadUrlOut
from api.domains.images.service import (
    get_repair_receipt_photo,
    list_repair_receipt_photos,
)
from api.errors import NotFoundError

router = APIRouter(prefix="/admin/repair-shipping-receipts", tags=["admin-images"])

class AdminRepairPhotoOut(BaseModel):
    id: uuid.UUID
    content_type: str | None
    size_bytes: int | None
    created_at: datetime


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
    images = await list_repair_receipt_photos(session, receipt)
    return [
        AdminRepairPhotoOut(
            id=image.id,
            content_type=image.content_type,
            size_bytes=image.size_bytes,
            created_at=image.created_at,
        )
        for image in images
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
    image = await get_repair_receipt_photo(session, receipt, image_id)
    return SignedReadUrlOut(read_url=await request.app.state.gcs.signed_read_url(image.object_key))
