import uuid
from collections.abc import Sequence
from typing import cast

from db.models.auth import User
from db.models.commerce import Order, OrderItem, Review
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import ensure_owner
from api.errors import ConflictError, DomainError, NotFoundError

from .schemas import (
    ReviewCreateRequest,
    ReviewListOut,
    ReviewOrderType,
    ReviewOut,
    ReviewUpdateRequest,
)

REVIEWABLE_STATUSES = {"완료", "배송완료", "제작완료", "수선완료"}
REVIEWABLE_ORDER_TYPES = {"sale", "repair", "custom", "sample"}


def masked_author_name(name: str | None) -> str:
    if not name:
        return "탈퇴 회원"
    return f"{name[0]}{'*' * max(2, len(name) - 1)}"


def review_out(review: Review, author: User | None) -> ReviewOut:
    return ReviewOut(
        id=review.id,
        rating=review.rating,
        content=review.content,
        created_at=review.created_at,
        order_type=cast(ReviewOrderType, review.order_type),
        product_id=review.product_id,
        author_name=masked_author_name(author.name if author is not None else None),
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


async def get_review(session: AsyncSession, review_id: uuid.UUID) -> ReviewOut:
    review, author = await _load_review_with_author(session, review_id)
    return review_out(review, author)


async def create_review(session: AsyncSession, user: User, body: ReviewCreateRequest) -> ReviewOut:
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
    )
    session.add(review)
    await session.commit()
    await session.refresh(review)
    return review_out(review, user)


async def list_reviews(
    session: AsyncSession,
    filters: Sequence[ColumnElement[bool]],
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
        items=[review_out(review, author) for review, author in rows],
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
) -> ReviewOut:
    review = await session.get(Review, review_id)
    ensure_owner(review, user)
    assert review is not None
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(review, field, value)
    await session.commit()
    await session.refresh(review)
    author = await session.get(User, review.user_id) if review.user_id is not None else None
    return review_out(review, author)


async def delete_review(session: AsyncSession, user: User, review_id: uuid.UUID) -> None:
    review = await session.get(Review, review_id)
    ensure_owner(review, user)
    assert review is not None
    await session.delete(review)
    await session.commit()
