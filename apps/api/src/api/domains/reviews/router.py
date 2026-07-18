import uuid
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath
from typing import Annotated

from db.models.commerce import Review
from db.models.images import Image
from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from api.db import SessionDep
from api.deps import CurrentUser
from api.errors import ConflictError, DomainError, NotFoundError
from api.integrations.gcs import assets_bucket_name

from . import service
from .schemas import (
    MAX_REVIEW_PHOTO_BYTES,
    ReviewCreateRequest,
    ReviewListOut,
    ReviewOut,
    ReviewPhotoUploadCompleteOut,
    ReviewPhotoUploadOut,
    ReviewPhotoUploadRequest,
    ReviewUpdateRequest,
    ServiceReviewOrderType,
)

router = APIRouter(prefix="/reviews", tags=["reviews"])

ALLOWED_PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
REVIEW_PHOTO_UPLOAD_TTL = timedelta(hours=24)


def _assets_bucket(request: Request) -> str:
    bucket = assets_bucket_name(request.app.state.settings)
    if bucket is None:
        raise DomainError(
            "후기 사진 저장소를 사용할 수 없습니다",
            code="review_photos_unavailable",
            status=503,
        )
    return bucket


@router.post("", response_model=ReviewOut, status_code=201)
async def create_review(
    body: ReviewCreateRequest, session: SessionDep, user: CurrentUser, request: Request
) -> ReviewOut:
    return await service.create_review(session, user, body, request.app.state.settings)


@router.get("", response_model=ReviewListOut)
async def list_reviews(
    session: SessionDep,
    request: Request,
    product_id: Annotated[int | None, Query(ge=1)] = None,
    order_type: ServiceReviewOrderType | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ReviewListOut:
    if (product_id is None) == (order_type is None):
        raise DomainError(
            "product_id와 order_type 중 하나만 지정해 주세요",
            code="invalid_review_filter",
            status=422,
        )
    filters = (
        [Review.product_id == product_id, Review.order_type == "sale"]
        if product_id is not None
        else [Review.order_type == order_type]
    )
    return await service.list_reviews(
        session, filters, request.app.state.settings, limit=limit, offset=offset
    )


@router.post("/photo-uploads", response_model=ReviewPhotoUploadOut)
async def create_review_photo_upload_url(
    body: ReviewPhotoUploadRequest,
    session: SessionDep,
    user: CurrentUser,
    request: Request,
) -> ReviewPhotoUploadOut:
    extension = PurePosixPath(body.filename).suffix.lower()
    if (
        extension not in ALLOWED_PHOTO_EXTENSIONS
        or body.content_type not in service.ALLOWED_REVIEW_PHOTO_TYPES
    ):
        raise DomainError("지원하지 않는 이미지 형식입니다", code="invalid_image_type")
    object_key = f"{service.REVIEW_PHOTO_PREFIX}{uuid.uuid4().hex}{extension}"
    expires_at = datetime.now(UTC) + REVIEW_PHOTO_UPLOAD_TTL
    image = Image(
        object_key=object_key,
        entity_type=service.REVIEW_PHOTO_UPLOAD_TYPE,
        entity_id=object_key,
        uploaded_by=user.id,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
        expires_at=expires_at,
    )
    session.add(image)
    await session.flush()
    upload_url = await request.app.state.gcs.signed_upload_url(
        object_key,
        body.content_type,
        max_size_bytes=MAX_REVIEW_PHOTO_BYTES,
        bucket_name=_assets_bucket(request),
        create_only=True,
    )
    await session.commit()
    return ReviewPhotoUploadOut(
        upload_id=image.id,
        upload_url=upload_url,
        required_headers={
            "Content-Type": body.content_type,
            "x-goog-content-length-range": f"1,{MAX_REVIEW_PHOTO_BYTES}",
            "x-goog-if-generation-match": "0",
        },
        expires_at=expires_at,
        upload_required=request.app.state.gcs.upload_required,
    )


@router.post("/photo-uploads/{upload_id}/complete", response_model=ReviewPhotoUploadCompleteOut)
async def complete_review_photo_upload(
    upload_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
    request: Request,
) -> ReviewPhotoUploadCompleteOut:
    image = await session.scalar(select(Image).where(Image.id == upload_id).with_for_update())
    if image is None or image.entity_type != service.REVIEW_PHOTO_UPLOAD_TYPE:
        raise NotFoundError("후기 사진 업로드를 찾을 수 없습니다")
    if image.uploaded_by != user.id:
        raise ConflictError("후기 사진 소유권이 일치하지 않습니다", code="ownership_conflict")
    now = datetime.now(UTC)
    if (
        image.deleted_at is not None
        or image.deletion_claimed_at is not None
        or (image.expires_at is not None and image.expires_at <= now)
    ):
        raise DomainError(
            "후기 사진 업로드가 만료되었습니다", code="review_photo_expired", status=409
        )
    if (
        image.content_type not in service.ALLOWED_REVIEW_PHOTO_TYPES
        or image.size_bytes is None
        or not 0 < image.size_bytes <= MAX_REVIEW_PHOTO_BYTES
        or not image.object_key.startswith(service.REVIEW_PHOTO_PREFIX)
    ):
        raise DomainError("유효하지 않은 후기 사진입니다", code="invalid_review_photo", status=409)

    metadata = await request.app.state.gcs.object_metadata(
        image.object_key, bucket_name=_assets_bucket(request)
    )
    if request.app.state.gcs.upload_required:
        if metadata is None:
            raise DomainError("업로드된 후기 사진을 찾을 수 없습니다", code="upload_not_found")
        if not 0 < metadata.size_bytes <= MAX_REVIEW_PHOTO_BYTES:
            raise DomainError("이미지는 10MB 이하여야 합니다", code="image_too_large")
        if metadata.content_type != image.content_type:
            raise DomainError("이미지 형식이 일치하지 않습니다", code="invalid_image_type")
        if metadata.size_bytes != image.size_bytes:
            raise DomainError("이미지 크기가 일치하지 않습니다", code="invalid_image_size")
    image.upload_completed_at = now
    await session.commit()
    return ReviewPhotoUploadCompleteOut(upload_id=image.id, completed_at=now)


@router.get("/{review_id}", response_model=ReviewOut)
async def get_review(review_id: uuid.UUID, session: SessionDep, request: Request) -> ReviewOut:
    return await service.get_review(session, review_id, request.app.state.settings)


@router.patch("/{review_id}", response_model=ReviewOut)
async def update_review(
    review_id: uuid.UUID,
    body: ReviewUpdateRequest,
    session: SessionDep,
    user: CurrentUser,
    request: Request,
) -> ReviewOut:
    return await service.update_review(session, user, review_id, body, request.app.state.settings)


@router.delete("/{review_id}", status_code=204)
async def delete_review(review_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    await service.delete_review(session, user, review_id)
