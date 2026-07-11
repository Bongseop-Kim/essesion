"""1:1 문의 — 고객 작성·조회 + 관리자 답변."""

import uuid
from datetime import UTC, datetime
from typing import Literal, cast

from db.models.commerce import Inquiry
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from api.db import SessionDep
from api.deps import AdminUser, CurrentUser, ensure_owner
from api.errors import DomainError, NotFoundError

router = APIRouter(tags=["inquiries"])

InquiryCategory = Literal["일반", "상품", "수선", "주문제작"]


class InquiryCreateRequest(BaseModel):
    category: InquiryCategory = "일반"
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=5000)
    product_id: int | None = None


class InquiryUpdateRequest(BaseModel):
    # 내부 None 기본값은 필드 생략을 허용하고, non-null 선언은 명시적 JSON null을 거부한다.
    category: InquiryCategory = cast(InquiryCategory, None)
    title: str = Field(default=cast(str, None), min_length=1, max_length=200)
    content: str = Field(default=cast(str, None), min_length=1, max_length=5000)
    product_id: int | None = None


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
    created_at: datetime


class InquiryAnswerRequest(BaseModel):
    answer: str = Field(min_length=1)


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


# ---- 관리자 ----


@router.get("/admin/inquiries", response_model=list[InquiryOut])
async def admin_list_inquiries(session: SessionDep, admin: AdminUser) -> list[InquiryOut]:
    rows = await session.scalars(select(Inquiry).order_by(Inquiry.created_at.desc()))
    return [InquiryOut.model_validate(i) for i in rows]


@router.post("/admin/inquiries/{inquiry_id}/answer", response_model=InquiryOut)
async def answer_inquiry(
    inquiry_id: uuid.UUID, body: InquiryAnswerRequest, session: SessionDep, admin: AdminUser
) -> InquiryOut:
    inquiry = await session.scalar(
        select(Inquiry).where(Inquiry.id == inquiry_id).with_for_update()
    )
    if inquiry is None:
        raise NotFoundError("문의를 찾을 수 없습니다")
    inquiry.answer = body.answer
    inquiry.answer_date = datetime.now(UTC)
    inquiry.status = "답변완료"
    await session.commit()
    await session.refresh(inquiry)
    return InquiryOut.model_validate(inquiry)
