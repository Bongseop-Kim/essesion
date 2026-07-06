"""이미지 — GCS 서명 업로드 URL(ImageKit 대체) + 업로드 등록 (domains.md §8)."""

import uuid
from datetime import datetime
from pathlib import PurePosixPath
from typing import Literal

from db.models.images import Image
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.db import SessionDep
from api.deps import CurrentUser
from api.errors import ConflictError, DomainError

router = APIRouter(tags=["images"])

UploadKind = Literal[
    "reform_upload", "repair_shipping_upload", "custom_order", "sample_order", "quote_request"
]

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


class UploadUrlRequest(BaseModel):
    kind: UploadKind
    filename: str
    content_type: str


class UploadUrlResponse(BaseModel):
    object_key: str
    upload_url: str


class UploadRegisterRequest(BaseModel):
    object_key: str


class ImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    object_key: str
    entity_type: str
    entity_id: str
    expires_at: datetime | None
    created_at: datetime


@router.post("/images/upload-url", response_model=UploadUrlResponse)
async def create_upload_url(
    body: UploadUrlRequest, user: CurrentUser, request: Request
) -> UploadUrlResponse:
    extension = PurePosixPath(body.filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS or body.content_type not in ALLOWED_CONTENT_TYPES:
        raise DomainError("지원하지 않는 이미지 형식입니다", code="invalid_image_type")
    object_key = f"uploads/{body.kind}/{uuid.uuid4().hex}{extension}"
    upload_url = await request.app.state.gcs.signed_upload_url(object_key, body.content_type)
    return UploadUrlResponse(object_key=object_key, upload_url=upload_url)


async def _register_upload(session, user_id: uuid.UUID, entity_type: str, object_key: str) -> Image:
    """entity_id=object_key 부분 unique upsert — 소유자만 갱신 가능 (원 동작)."""
    result = await session.execute(
        pg_insert(Image)
        .values(
            object_key=object_key,
            entity_type=entity_type,
            entity_id=object_key,
            uploaded_by=user_id,
            deleted_at=None,
            deletion_claimed_at=None,
        )
        .on_conflict_do_update(
            index_elements=[Image.entity_type, Image.entity_id],
            index_where=Image.entity_type == entity_type,
            set_={"uploaded_by": user_id, "deleted_at": None, "deletion_claimed_at": None},
            where=Image.uploaded_by == user_id,
        )
        .returning(Image.id)
    )
    image_id = result.scalar()
    if image_id is None:
        raise ConflictError(f"{entity_type} ownership conflict", code="ownership_conflict")
    await session.commit()
    return await session.get(Image, image_id)


@router.post("/images/reform-uploads", response_model=ImageOut, status_code=201)
async def register_reform_upload(
    body: UploadRegisterRequest, session: SessionDep, user: CurrentUser
) -> ImageOut:
    image = await _register_upload(session, user.id, "reform_upload", body.object_key)
    return ImageOut.model_validate(image)


@router.post("/images/repair-shipping-uploads", response_model=ImageOut, status_code=201)
async def register_repair_shipping_upload(
    body: UploadRegisterRequest, session: SessionDep, user: CurrentUser
) -> ImageOut:
    image = await _register_upload(session, user.id, "repair_shipping_upload", body.object_key)
    return ImageOut.model_validate(image)
