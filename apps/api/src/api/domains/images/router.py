"""이미지 — GCS 서명 업로드 URL(ImageKit 대체) + 업로드 등록 (domains.md §8)."""

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath
from typing import Literal

from db.models.images import Image
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from api.db import SessionDep
from api.deps import CurrentUser, OptionalUser
from api.domains.images.service import (
    MAX_ORDER_IMAGE_BYTES,
    OrderImageKind,
    complete_order_image_upload,
    order_upload_entity_type,
)
from api.errors import ConflictError, DomainError

router = APIRouter(tags=["images"])

UploadKind = Literal["repair_shipping_upload", "custom_order", "sample_order", "quote_request"]

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_REFORM_IMAGE_BYTES = 10 * 1024 * 1024
REFORM_UPLOAD_TTL = timedelta(hours=24)
QUOTE_UPLOAD_TTL = timedelta(hours=24)
ORDER_UPLOAD_TTL = timedelta(hours=24)
REPAIR_SHIPPING_UPLOAD_PREFIX = "uploads/repair_shipping_upload/"


class UploadUrlRequest(BaseModel):
    kind: UploadKind
    filename: str
    content_type: str
    size_bytes: int = Field(gt=0, le=MAX_ORDER_IMAGE_BYTES)


class UploadUrlResponse(BaseModel):
    object_key: str
    upload_id: uuid.UUID
    upload_url: str
    required_headers: dict[str, str]
    upload_required: bool


class ReformUploadUrlRequest(BaseModel):
    filename: str
    content_type: str
    size_bytes: int = Field(gt=0, le=MAX_REFORM_IMAGE_BYTES)


class ReformUploadUrlResponse(BaseModel):
    object_key: str
    upload_url: str
    required_headers: dict[str, str]
    claim_token: str | None
    expires_at: datetime
    upload_required: bool


class UploadRegisterRequest(BaseModel):
    object_key: str


class RepairShippingUploadCompleteRequest(BaseModel):
    upload_id: uuid.UUID


class ReformUploadCompleteRequest(UploadRegisterRequest):
    claim_token: str | None = None
    size_bytes: int = Field(gt=0, le=MAX_REFORM_IMAGE_BYTES)


class ReadUrlRequest(BaseModel):
    object_key: str
    claim_token: str | None = None


class ReadUrlResponse(BaseModel):
    read_url: str


class ImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    object_key: str
    entity_type: str
    entity_id: str
    expires_at: datetime | None
    created_at: datetime


class OrderImageUploadOut(BaseModel):
    upload_id: uuid.UUID
    kind: OrderImageKind
    content_type: str
    size_bytes: int
    upload_completed_at: datetime


@router.post("/images/upload-url", response_model=UploadUrlResponse)
async def create_upload_url(
    body: UploadUrlRequest,
    session: SessionDep,
    user: CurrentUser,
    request: Request,
) -> UploadUrlResponse:
    extension = PurePosixPath(body.filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS or body.content_type not in ALLOWED_CONTENT_TYPES:
        raise DomainError("지원하지 않는 이미지 형식입니다", code="invalid_image_type")
    object_key = f"uploads/{body.kind}/{uuid.uuid4().hex}{extension}"
    # 모든 업로드 종류를 발급 시점에 스테이징해 완료 요청이 임의의 object_key를
    # 등록하지 못하게 한다.
    entity_type = (
        "quote_request_upload"
        if body.kind == "quote_request"
        else (
            "repair_shipping_upload"
            if body.kind == "repair_shipping_upload"
            else order_upload_entity_type(body.kind)
        )
    )
    staged_image = Image(
        object_key=object_key,
        entity_type=entity_type,
        entity_id=object_key,
        uploaded_by=user.id,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
        expires_at=datetime.now(UTC)
        + (QUOTE_UPLOAD_TTL if body.kind == "quote_request" else ORDER_UPLOAD_TTL),
    )
    session.add(staged_image)
    await session.flush()
    upload_url = await request.app.state.gcs.signed_upload_url(
        object_key,
        body.content_type,
        max_size_bytes=MAX_ORDER_IMAGE_BYTES,
        create_only=True,
    )
    await session.commit()
    return UploadUrlResponse(
        object_key=object_key,
        upload_id=staged_image.id,
        upload_url=upload_url,
        required_headers={
            "Content-Type": body.content_type,
            "x-goog-if-generation-match": "0",
            "x-goog-content-length-range": f"1,{MAX_ORDER_IMAGE_BYTES}",
        },
        upload_required=request.app.state.gcs.upload_required,
    )


@router.post(
    "/images/order-uploads/{upload_id}/complete",
    response_model=OrderImageUploadOut,
)
async def complete_order_image(
    upload_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
    request: Request,
) -> OrderImageUploadOut:
    image = await complete_order_image_upload(session, user, upload_id, request.app.state.gcs)
    await session.commit()
    await session.refresh(image)
    kind: OrderImageKind = (
        "custom_order" if image.entity_type == "custom_order_upload" else "sample_order"
    )
    assert image.content_type is not None
    assert image.size_bytes is not None
    assert image.upload_completed_at is not None
    return OrderImageUploadOut(
        upload_id=image.id,
        kind=kind,
        content_type=image.content_type,
        size_bytes=image.size_bytes,
        upload_completed_at=image.upload_completed_at,
    )


@router.post("/images/reform-upload-url", response_model=ReformUploadUrlResponse)
async def create_reform_upload_url(
    body: ReformUploadUrlRequest,
    session: SessionDep,
    user: OptionalUser,
    request: Request,
) -> ReformUploadUrlResponse:
    extension = PurePosixPath(body.filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS or body.content_type not in ALLOWED_CONTENT_TYPES:
        raise DomainError("지원하지 않는 이미지 형식입니다", code="invalid_image_type")

    object_key = f"uploads/reform_upload/{uuid.uuid4().hex}{extension}"
    raw_token = secrets.token_urlsafe(32) if user is None else None
    expires_at = datetime.now(UTC) + REFORM_UPLOAD_TTL
    session.add(
        Image(
            object_key=object_key,
            entity_type="reform_upload",
            entity_id=object_key,
            uploaded_by=user.id if user else None,
            claim_token_hash=(
                hashlib.sha256(raw_token.encode()).hexdigest() if raw_token else None
            ),
            content_type=body.content_type,
            size_bytes=body.size_bytes,
            expires_at=expires_at,
        )
    )
    upload_url = await request.app.state.gcs.signed_upload_url(
        object_key,
        body.content_type,
        max_size_bytes=MAX_REFORM_IMAGE_BYTES,
        create_only=True,
    )
    await session.commit()
    return ReformUploadUrlResponse(
        object_key=object_key,
        upload_url=upload_url,
        required_headers={
            "Content-Type": body.content_type,
            "x-goog-content-length-range": f"1,{MAX_REFORM_IMAGE_BYTES}",
            "x-goog-if-generation-match": "0",
        },
        claim_token=raw_token,
        expires_at=expires_at,
        upload_required=request.app.state.gcs.upload_required,
    )


@router.post("/images/reform-uploads", response_model=ImageOut, status_code=201)
async def register_reform_upload(
    body: ReformUploadCompleteRequest,
    session: SessionDep,
    user: OptionalUser,
    request: Request,
) -> ImageOut:
    image = await session.scalar(
        select(Image)
        .where(
            Image.entity_type == "reform_upload",
            Image.entity_id == body.object_key,
            Image.deleted_at.is_(None),
        )
        .with_for_update()
    )
    if image is None:
        raise DomainError("수선 사진 업로드를 찾을 수 없습니다", code="invalid_reform_image")
    if image.expires_at is not None and image.expires_at <= datetime.now(UTC):
        raise DomainError("수선 사진이 만료되었습니다", code="reform_image_expired")

    if image.uploaded_by is not None:
        if user is None or image.uploaded_by != user.id:
            raise ConflictError("reform upload ownership conflict", code="ownership_conflict")
    else:
        if not body.claim_token or not image.claim_token_hash:
            raise ConflictError("reform upload ownership conflict", code="ownership_conflict")
        token_hash = hashlib.sha256(body.claim_token.encode()).hexdigest()
        if not hmac.compare_digest(token_hash, image.claim_token_hash):
            raise ConflictError("reform upload ownership conflict", code="ownership_conflict")
        if user is not None:
            image.uploaded_by = user.id
            image.claim_token_hash = None

    metadata = await request.app.state.gcs.object_metadata(body.object_key)
    if request.app.state.gcs.upload_required:
        if metadata is None:
            raise DomainError("업로드된 수선 사진을 찾을 수 없습니다", code="upload_not_found")
        if not 0 < metadata.size_bytes <= MAX_REFORM_IMAGE_BYTES:
            raise DomainError("이미지는 10MB 이하여야 합니다", code="image_too_large")
        if metadata.content_type != image.content_type:
            raise DomainError("이미지 형식이 일치하지 않습니다", code="invalid_image_type")
        if metadata.size_bytes != image.size_bytes or body.size_bytes != image.size_bytes:
            raise DomainError("이미지 크기가 일치하지 않습니다", code="invalid_image_size")
        image.size_bytes = metadata.size_bytes
    else:
        if body.size_bytes != image.size_bytes:
            raise DomainError("이미지 크기가 일치하지 않습니다", code="invalid_image_size")
        image.size_bytes = body.size_bytes
    image.upload_completed_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(image)
    return ImageOut.model_validate(image)


@router.post("/images/read-url", response_model=ReadUrlResponse)
async def create_read_url(
    body: ReadUrlRequest,
    session: SessionDep,
    user: OptionalUser,
    request: Request,
) -> ReadUrlResponse:
    image = await session.scalar(
        select(Image).where(Image.object_key == body.object_key, Image.deleted_at.is_(None))
    )
    if image is None or image.upload_completed_at is None:
        raise DomainError("이미지를 찾을 수 없습니다", code="image_not_found", status=404)
    if image.expires_at is not None and image.expires_at <= datetime.now(UTC):
        raise DomainError("이미지가 만료되었습니다", code="image_expired")
    if image.uploaded_by is not None:
        if user is None or image.uploaded_by != user.id:
            raise DomainError("이미지를 볼 권한이 없습니다", code="forbidden", status=403)
    else:
        if not body.claim_token or not image.claim_token_hash:
            raise DomainError("이미지를 볼 권한이 없습니다", code="forbidden", status=403)
        token_hash = hashlib.sha256(body.claim_token.encode()).hexdigest()
        if not hmac.compare_digest(token_hash, image.claim_token_hash):
            raise DomainError("이미지를 볼 권한이 없습니다", code="forbidden", status=403)
    return ReadUrlResponse(read_url=await request.app.state.gcs.signed_read_url(image.object_key))


@router.post("/images/repair-shipping-uploads", response_model=ImageOut, status_code=201)
async def register_repair_shipping_upload(
    body: RepairShippingUploadCompleteRequest,
    session: SessionDep,
    user: CurrentUser,
    request: Request,
) -> ImageOut:
    image = await session.scalar(select(Image).where(Image.id == body.upload_id).with_for_update())
    if (
        image is None
        or image.entity_type != "repair_shipping_upload"
        or image.entity_id != image.object_key
        or not image.object_key.startswith(REPAIR_SHIPPING_UPLOAD_PREFIX)
    ):
        raise DomainError(
            "유효하지 않은 수선 배송 사진입니다",
            code="invalid_repair_shipping_image",
        )
    if image.uploaded_by != user.id:
        raise ConflictError(
            "수선 배송 사진 소유권이 일치하지 않습니다",
            code="ownership_conflict",
        )
    if image.deleted_at is not None or (
        image.expires_at is not None and image.expires_at <= datetime.now(UTC)
    ):
        raise DomainError(
            "만료되거나 삭제된 수선 배송 사진입니다",
            code="repair_shipping_image_expired",
        )
    if image.content_type not in ALLOWED_CONTENT_TYPES:
        raise DomainError("이미지 형식이 일치하지 않습니다", code="invalid_image_type")
    if image.size_bytes is None or not 0 < image.size_bytes <= MAX_ORDER_IMAGE_BYTES:
        raise DomainError("이미지는 10MB 이하여야 합니다", code="image_too_large")

    if request.app.state.gcs.upload_required:
        metadata = await request.app.state.gcs.object_metadata(image.object_key)
        if metadata is None:
            raise DomainError("업로드된 수선 배송 사진을 찾을 수 없습니다", code="upload_not_found")
        if not 0 < metadata.size_bytes <= MAX_ORDER_IMAGE_BYTES:
            raise DomainError("이미지는 10MB 이하여야 합니다", code="image_too_large")
        if metadata.content_type != image.content_type:
            raise DomainError("이미지 형식이 일치하지 않습니다", code="invalid_image_type")
        if metadata.size_bytes != image.size_bytes:
            raise DomainError("이미지 크기가 일치하지 않습니다", code="invalid_image_size")

    image.upload_completed_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(image)
    return ImageOut.model_validate(image)
