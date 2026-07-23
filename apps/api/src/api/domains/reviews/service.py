import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import cast

from db.models.auth import User
from db.models.commerce import Order, OrderItem, Review
from db.models.images import Image
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import Settings
from api.deps import ensure_owner
from api.domains.orders.status_machine import REVIEWABLE_STATUSES
from api.errors import ConflictError, DomainError, NotFoundError
from api.integrations.gcs import public_asset_url

from .schemas import (
    MAX_REVIEW_PHOTO_BYTES,
    ReviewCreateRequest,
    ReviewListOut,
    ReviewOrderType,
    ReviewOut,
    ReviewPhotoOut,
    ReviewUpdateRequest,
)

REVIEWABLE_ORDER_TYPES = {"sale", "repair", "custom", "sample"}

# 사진은 공개 콘텐츠라 상품 이미지처럼 공개 assets 버킷에 둔다 (서명 read URL 아님).
REVIEW_PHOTO_PREFIX = "reviews/"
REVIEW_PHOTO_UPLOAD_TYPE = "review_photo_upload"
REVIEW_PHOTO_LINK_TYPE = "review_photo"
ALLOWED_REVIEW_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}


def masked_author_name(name: str | None) -> str:
    if not name:
        return "탈퇴 회원"
    return f"{name[0]}{'*' * max(2, len(name) - 1)}"


def _photo_outs(review: Review, settings: Settings) -> list[ReviewPhotoOut]:
    photos: list[ReviewPhotoOut] = []
    for entry in review.photos or []:
        if not isinstance(entry, dict):
            continue
        object_key = entry.get("object_key")
        upload_id = entry.get("upload_id")
        if not isinstance(object_key, str) or not isinstance(upload_id, str):
            continue
        url = public_asset_url(settings, object_key)
        if url is None:
            continue
        photos.append(ReviewPhotoOut(upload_id=uuid.UUID(upload_id), url=url))
    return photos


def review_out(review: Review, author: User | None, settings: Settings) -> ReviewOut:
    return ReviewOut(
        id=review.id,
        rating=review.rating,
        content=review.content,
        created_at=review.created_at,
        order_type=cast(ReviewOrderType, review.order_type),
        product_id=review.product_id,
        author_name=masked_author_name(author.name if author is not None else None),
        photos=_photo_outs(review, settings),
    )


async def _load_review_with_author(
    session: AsyncSession, review_id: uuid.UUID
) -> tuple[Review, User | None]:
    row = (
        await session.execute(
            select(Review, User)
            .outerjoin(User, User.id == Review.user_id)
            .where(Review.id == review_id)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("후기를 찾을 수 없습니다")
    return row[0], row[1]


async def get_review(session: AsyncSession, review_id: uuid.UUID, settings: Settings) -> ReviewOut:
    review, author = await _load_review_with_author(session, review_id)
    return review_out(review, author, settings)


def _validate_review_photo(image: Image, user: User, review_id: uuid.UUID) -> None:
    is_staged = (
        image.entity_type == REVIEW_PHOTO_UPLOAD_TYPE and image.entity_id == image.object_key
    )
    is_linked = image.entity_type == REVIEW_PHOTO_LINK_TYPE and image.entity_id == str(review_id)
    if not is_staged and not is_linked:
        raise DomainError("유효하지 않은 후기 사진입니다", code="invalid_review_photo", status=409)
    if image.uploaded_by != user.id:
        raise ConflictError("후기 사진 소유권이 일치하지 않습니다", code="ownership_conflict")
    if (
        image.deleted_at is not None
        or image.deletion_claimed_at is not None
        or (image.expires_at is not None and image.expires_at <= datetime.now(UTC))
    ):
        raise DomainError(
            "후기 사진이 만료되었거나 삭제되었습니다", code="review_photo_expired", status=409
        )
    if image.upload_completed_at is None:
        raise DomainError(
            "후기 사진 업로드를 먼저 완료해 주세요", code="review_photo_incomplete", status=409
        )
    if image.content_type not in ALLOWED_REVIEW_PHOTO_TYPES:
        raise DomainError("이미지 형식이 일치하지 않습니다", code="invalid_image_type")
    if image.size_bytes is None or not 0 < image.size_bytes <= MAX_REVIEW_PHOTO_BYTES:
        raise DomainError("이미지는 10MB 이하여야 합니다", code="image_too_large")
    if not image.object_key.startswith(REVIEW_PHOTO_PREFIX):
        raise DomainError("유효하지 않은 후기 사진입니다", code="invalid_review_photo", status=409)


async def _resolve_review_photos(
    session: AsyncSession,
    user: User,
    review_id: uuid.UUID,
    upload_ids: list[uuid.UUID],
) -> list[Image]:
    if len(upload_ids) != len(set(upload_ids)):
        raise DomainError("후기 사진이 중복되었습니다", code="duplicate_review_photo", status=422)
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
            raise DomainError(
                "유효하지 않은 후기 사진입니다", code="invalid_review_photo", status=409
            )
        _validate_review_photo(image, user, review_id)
        ordered.append(image)
    return ordered


def _link_review_photos(review: Review, images: list[Image]) -> None:
    for image in images:
        image.entity_type = REVIEW_PHOTO_LINK_TYPE
        image.entity_id = str(review.id)
        image.expires_at = None
        image.deletion_claimed_at = None
    review.photos = [
        {"object_key": image.object_key, "upload_id": str(image.id)} for image in images
    ]


async def expire_review_photos(
    session: AsyncSession, review: Review, *, keep_ids: set[uuid.UUID] | None = None
) -> None:
    """링크된 후기 사진을 만료시켜 cleanup 배치가 assets 객체를 지우게 한다."""

    linked = await session.scalars(
        select(Image)
        .where(
            Image.entity_type == REVIEW_PHOTO_LINK_TYPE,
            Image.entity_id == str(review.id),
            Image.deleted_at.is_(None),
        )
        .with_for_update()
    )
    now = datetime.now(UTC)
    for image in linked:
        if keep_ids is not None and image.id in keep_ids:
            continue
        image.expires_at = now
        image.deletion_claimed_at = None


async def create_review(
    session: AsyncSession, user: User, body: ReviewCreateRequest, settings: Settings
) -> ReviewOut:
    order = await session.scalar(select(Order).where(Order.id == body.order_id).with_for_update())
    ensure_owner(order, user)
    assert order is not None
    if order.order_type not in REVIEWABLE_ORDER_TYPES or order.status not in REVIEWABLE_STATUSES:
        raise ConflictError("완료된 주문에만 후기를 작성할 수 있습니다", code="review_not_allowed")

    item: OrderItem | None = None
    if order.order_type == "sale":
        if body.order_item_id is None:
            raise DomainError(
                "상품 주문 후기에는 주문 상품이 필요합니다",
                code="invalid_review_target",
                status=422,
            )
        item = await session.get(OrderItem, body.order_item_id)
        if (
            item is None
            or item.order_id != order.id
            or item.item_type != "product"
            or item.product_id is None
        ):
            raise ConflictError(
                "해당 주문의 상품에만 후기를 작성할 수 있습니다",
                code="invalid_review_target",
            )
    elif body.order_item_id is not None:
        raise DomainError(
            "서비스 후기는 주문 단위로 작성해 주세요",
            code="invalid_review_target",
            status=422,
        )

    duplicate_filter = (
        Review.order_item_id == body.order_item_id
        if body.order_item_id is not None
        else Review.order_item_id.is_(None)
    )
    if await session.scalar(select(Review.id).where(Review.order_id == order.id, duplicate_filter)):
        raise ConflictError("이미 후기를 작성했습니다", code="review_exists")

    review = Review(
        order_id=order.id,
        order_item_id=body.order_item_id,
        user_id=user.id,
        order_type=order.order_type,
        product_id=item.product_id if item is not None else None,
        rating=body.rating,
        content=body.content,
        photos=[],
    )
    session.add(review)
    await session.flush()
    photos = await _resolve_review_photos(session, user, review.id, body.photo_upload_ids)
    _link_review_photos(review, photos)
    await session.commit()
    await session.refresh(review)
    return review_out(review, user, settings)


async def list_reviews(
    session: AsyncSession,
    filters: Sequence[ColumnElement[bool]],
    settings: Settings,
    *,
    limit: int,
    offset: int,
) -> ReviewListOut:
    total, average = (
        await session.execute(
            select(func.count(Review.id), func.avg(Review.rating)).where(*filters)
        )
    ).one()
    rows = (
        await session.execute(
            select(Review, User)
            .outerjoin(User, User.id == Review.user_id)
            .where(*filters)
            .order_by(Review.created_at.desc(), Review.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return ReviewListOut(
        items=[review_out(review, author, settings) for review, author in rows],
        total=int(total),
        avg_rating=round(float(average or 0), 2),
        limit=limit,
        offset=offset,
    )


async def update_review(
    session: AsyncSession,
    user: User,
    review_id: uuid.UUID,
    body: ReviewUpdateRequest,
    settings: Settings,
) -> ReviewOut:
    # 사진 링크·만료가 동시 변이와 엇갈리지 않도록 후기 행을 먼저 잠근다.
    review = await session.scalar(select(Review).where(Review.id == review_id).with_for_update())
    ensure_owner(review, user)
    assert review is not None
    changes = body.model_dump(exclude_unset=True)
    photos_requested = "photo_upload_ids" in changes
    changes.pop("photo_upload_ids", None)
    for field, value in changes.items():
        setattr(review, field, value)
    if photos_requested:
        photos = await _resolve_review_photos(session, user, review.id, body.photo_upload_ids)
        await expire_review_photos(session, review, keep_ids={image.id for image in photos})
        _link_review_photos(review, photos)
    await session.commit()
    await session.refresh(review)
    author = await session.get(User, review.user_id) if review.user_id is not None else None
    return review_out(review, author, settings)


async def delete_review(session: AsyncSession, user: User, review_id: uuid.UUID) -> None:
    review = await session.scalar(select(Review).where(Review.id == review_id).with_for_update())
    ensure_owner(review, user)
    assert review is not None
    await expire_review_photos(session, review)
    await session.delete(review)
    await session.commit()
