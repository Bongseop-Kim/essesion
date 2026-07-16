"""1:1 문의 — 고객 작성·조회 + 관리자 답변."""

import uuid
from datetime import datetime
from typing import Annotated, Literal, cast

from db.models.auth import User
from db.models.commerce import Inquiry
from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from api.db import SessionDep
from api.deps import CurrentUser, OptionalUser, ensure_owner
from api.domains.reviews.service import masked_author_name
from api.errors import DomainError

router = APIRouter(tags=["inquiries"])

InquiryCategory = Literal["일반", "상품", "수선", "주문제작", "샘플제작"]
PublicInquiryCategory = Literal["수선", "주문제작", "샘플제작"]


class InquiryCreateRequest(BaseModel):
    category: InquiryCategory = "일반"
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=5000)
    product_id: int | None = None
    is_secret: bool = False


class InquiryUpdateRequest(BaseModel):
    # 내부 None 기본값은 필드 생략을 허용하고, non-null 선언은 명시적 JSON null을 거부한다.
    category: InquiryCategory = cast(InquiryCategory, None)
    title: str = Field(default=cast(str, None), min_length=1, max_length=200)
    content: str = Field(default=cast(str, None), min_length=1, max_length=5000)
    product_id: int | None = None
    is_secret: bool = cast(bool, None)


class InquiryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category: str
    title: str
    content: str
    status: str
    answer: str | None
    answer_date: datetime | None
    product_id: int | None
    is_secret: bool
    created_at: datetime


class PublicInquiryOut(BaseModel):
    id: uuid.UUID
    category: str
    title: str
    content: str | None
    status: str
    answer: str | None
    answer_date: datetime | None
    created_at: datetime
    author_name: str
    is_secret: bool
    is_mine: bool


class PublicInquiryListOut(BaseModel):
    items: list[PublicInquiryOut]
    total: int
    limit: int
    offset: int


@router.post("/inquiries", response_model=InquiryOut, status_code=201)
async def create_inquiry(
    body: InquiryCreateRequest, session: SessionDep, user: CurrentUser
) -> InquiryOut:
    inquiry = Inquiry(user_id=user.id, **body.model_dump())
    session.add(inquiry)
    await session.commit()
    await session.refresh(inquiry)
    return InquiryOut.model_validate(inquiry)


@router.get("/inquiries", response_model=list[InquiryOut])
async def list_my_inquiries(session: SessionDep, user: CurrentUser) -> list[InquiryOut]:
    rows = await session.scalars(
        select(Inquiry).where(Inquiry.user_id == user.id).order_by(Inquiry.created_at.desc())
    )
    return [InquiryOut.model_validate(i) for i in rows]


@router.get("/inquiries/public", response_model=PublicInquiryListOut)
async def list_public_inquiries(
    session: SessionDep,
    user: OptionalUser,
    product_id: Annotated[int | None, Query(ge=1)] = None,
    category: PublicInquiryCategory | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PublicInquiryListOut:
    if (product_id is None) == (category is None):
        raise DomainError(
            "product_id와 category 중 하나만 지정해 주세요",
            code="invalid_inquiry_filter",
            status=422,
        )
    filters = (
        [Inquiry.product_id == product_id, Inquiry.category == "상품"]
        if product_id is not None
        else [Inquiry.category == category]
    )
    total = int(await session.scalar(select(func.count(Inquiry.id)).where(*filters)) or 0)
    rows = (
        await session.execute(
            select(Inquiry, User)
            .outerjoin(User, User.id == Inquiry.user_id)
            .where(*filters)
            .order_by(Inquiry.created_at.desc(), Inquiry.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    items = []
    for inquiry, author in rows:
        is_mine = user is not None and inquiry.user_id == user.id
        masked = inquiry.is_secret and not is_mine
        items.append(
            PublicInquiryOut(
                id=inquiry.id,
                category=inquiry.category,
                title="비밀글입니다" if masked else inquiry.title,
                content=None if masked else inquiry.content,
                status=inquiry.status,
                answer=None if masked else inquiry.answer,
                answer_date=inquiry.answer_date,
                created_at=inquiry.created_at,
                author_name=masked_author_name(author.name if author is not None else None),
                is_secret=inquiry.is_secret,
                is_mine=is_mine,
            )
        )
    return PublicInquiryListOut(items=items, total=total, limit=limit, offset=offset)


@router.get("/inquiries/{inquiry_id}", response_model=InquiryOut)
async def get_inquiry(inquiry_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> InquiryOut:
    inquiry = await session.get(Inquiry, inquiry_id)
    ensure_owner(inquiry, user)
    return InquiryOut.model_validate(inquiry)


async def _get_pending_inquiry(
    inquiry_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> Inquiry:
    inquiry = await session.scalar(
        select(Inquiry).where(Inquiry.id == inquiry_id).with_for_update()
    )
    ensure_owner(inquiry, user)
    assert inquiry is not None
    if inquiry.status != "답변대기":
        raise DomainError(
            "답변 대기 상태의 문의만 수정하거나 삭제할 수 있습니다",
            code="invalid_status",
        )
    return inquiry


@router.patch("/inquiries/{inquiry_id}", response_model=InquiryOut)
async def update_inquiry(
    inquiry_id: uuid.UUID,
    body: InquiryUpdateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> InquiryOut:
    inquiry = await _get_pending_inquiry(inquiry_id, session, user)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(inquiry, field, value)
    await session.commit()
    await session.refresh(inquiry)
    return InquiryOut.model_validate(inquiry)


@router.delete("/inquiries/{inquiry_id}", status_code=204)
async def delete_inquiry(inquiry_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    inquiry = await _get_pending_inquiry(inquiry_id, session, user)
    await session.delete(inquiry)
    await session.commit()
