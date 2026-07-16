import uuid
from typing import Annotated

from db.models.commerce import Review
from fastapi import APIRouter, Query

from api.db import SessionDep
from api.deps import CurrentUser
from api.errors import DomainError

from . import service
from .schemas import (
    ReviewCreateRequest,
    ReviewListOut,
    ReviewOut,
    ReviewUpdateRequest,
    ServiceReviewOrderType,
)

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.post("", response_model=ReviewOut, status_code=201)
async def create_review(
    body: ReviewCreateRequest, session: SessionDep, user: CurrentUser
) -> ReviewOut:
    return await service.create_review(session, user, body)


@router.get("", response_model=ReviewListOut)
async def list_reviews(
    session: SessionDep,
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
    return await service.list_reviews(session, filters, limit=limit, offset=offset)


@router.get("/{review_id}", response_model=ReviewOut)
async def get_review(review_id: uuid.UUID, session: SessionDep) -> ReviewOut:
    return await service.get_review(session, review_id)


@router.patch("/{review_id}", response_model=ReviewOut)
async def update_review(
    review_id: uuid.UUID,
    body: ReviewUpdateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> ReviewOut:
    return await service.update_review(session, user, review_id, body)


@router.delete("/{review_id}", status_code=204)
async def delete_review(review_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    await service.delete_review(session, user, review_id)
