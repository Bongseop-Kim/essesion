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
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.db import SessionDep
from api.deps import CurrentUser, OptionalUser
from api.errors import ConflictError, DomainError

router = APIRouter(tags=["images"])

UploadKind = Literal["repair_shipping_upload", "custom_order", "sample_order", "quote_request"]

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_REFORM_IMAGE_BYTES = 10 * 1024 * 1024
REFORM_UPLOAD_TTL = timedelta(hours=24)
QUOTE_UPLOAD_TTL = timedelta(hours=24)


class UploadUrlRequest(BaseModel):
    kind: UploadKind
    filename: str
    content_type: str
    size_bytes: int | None = Field(default=None, gt=0, le=MAX_REFORM_IMAGE_BYTES)


class UploadUrlResponse(BaseModel):
    object_key: str
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
    if body.kind == "quote_request" and body.size_bytes is None:
        raise DomainError("견적 이미지 크기가 필요합니다", code="invalid_image_size")
    object_key = f"uploads/{body.kind}/{uuid.uuid4().hex}{extension}"
    if body.kind == "quote_request":
        # 견적 생성이 임의의 object_key를 신뢰하지 않도록 발급 시점에
        # 소유자·MIME·키를 스테이징한다. 미귀속 업로드는 정리 배치가 회수한다.
        session.add(
            Image(
                object_key=object_key,
                entity_type="quote_request_upload",
                entity_id=object_key,
                uploaded_by=user.id,
                content_type=body.content_type,
                size_bytes=body.size_bytes,
                expires_at=datetime.now(UTC) + QUOTE_UPLOAD_TTL,
            )
        )
        await session.flush()
    max_size_bytes = MAX_REFORM_IMAGE_BYTES if body.kind == "quote_request" else None
    upload_url = await request.app.state.gcs.signed_upload_url(
        object_key,
        body.content_type,
        max_size_bytes=max_size_bytes,
    )
    if body.kind == "quote_request":
        await session.commit()
    required_headers = {"Content-Type": body.content_type}
    if max_size_bytes is not None:
        required_headers["x-goog-content-length-range"] = f"1,{max_size_bytes}"
    return UploadUrlResponse(
        object_key=object_key,
        upload_url=upload_url,
        required_headers=required_headers,
        upload_required=request.app.state.gcs.upload_required,
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
    )
    await session.commit()
    return ReformUploadUrlResponse(
        object_key=object_key,
        upload_url=upload_url,
        required_headers={
            "Content-Type": body.content_type,
            "x-goog-content-length-range": f"1,{MAX_REFORM_IMAGE_BYTES}",
        },
        claim_token=raw_token,
        expires_at=expires_at,
        upload_required=request.app.state.gcs.upload_required,
    )


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
    body: UploadRegisterRequest, session: SessionDep, user: CurrentUser
) -> ImageOut:
    image = await _register_upload(session, user.id, "repair_shipping_upload", body.object_key)
    return ImageOut.model_validate(image)
