import uuid
from typing import Annotated

from db.models.commerce import Review
from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from api.db import SessionDep
from api.deps import AdminUser
from api.domains.admin.schemas import Page
from api.domains.reviews import service
from api.domains.reviews.schemas import ReviewOrderType, ReviewOut
from api.errors import DomainError, NotFoundError

router = APIRouter(prefix="/admin/reviews", tags=["admin-reviews"])


@router.get("", response_model=Page[ReviewOut])
async def list_admin_reviews(
    session: SessionDep,
    admin: AdminUser,
    request: Request,
    order_type: ReviewOrderType | None = None,
    rating: Annotated[int | None, Query(ge=1, le=5)] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ReviewOut]:
    filters = []
    if order_type is not None:
        filters.append(Review.order_type == order_type)
    if rating is not None:
        filters.append(Review.rating == rating)
    if q is not None:
        search = q.strip()
        if len(search) < 2:
            raise DomainError("검색어는 2자 이상이어야 합니다", code="search_too_short")
        filters.append(Review.content.icontains(search, autoescape=True))
    page = await service.list_reviews(
        session, filters, request.app.state.settings, limit=limit, offset=offset
    )
    return Page(items=page.items, total=page.total, limit=limit, offset=offset)


@router.delete("/{review_id}", status_code=204)
async def delete_admin_review(review_id: uuid.UUID, session: SessionDep, admin: AdminUser) -> None:
    review = await session.scalar(
        select(Review).where(Review.id == review_id).with_for_update()
    )
    if review is None:
        raise NotFoundError("후기를 찾을 수 없습니다")
    await service.expire_review_photos(session, review)
    await session.delete(review)
    await session.commit()
