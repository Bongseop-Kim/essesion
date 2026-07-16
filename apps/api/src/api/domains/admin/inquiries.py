"""관리자 문의 목록·상세·답변. PII 가능 검색어는 POST body로만 받는다."""

import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Any

from db.models.auth import User
from db.models.commerce import Inquiry, Product
from fastapi import APIRouter, Query
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import SessionDep
from api.deps import AdminUser
from api.domains.admin.helpers import kst_day_bounds
from api.domains.admin.inquiry_schemas import (
    AdminInquiryActorOut,
    AdminInquiryAnswerRequest,
    AdminInquiryCustomerOut,
    AdminInquiryDetailOut,
    AdminInquiryProductOut,
    AdminInquirySearchRequest,
    AdminInquirySummaryOut,
    InquiryCategoryFilter,
    InquirySort,
    InquiryStatusFilter,
)
from api.domains.admin.schemas import Page
from api.domains.admin.types import SortDirection
from api.errors import ConflictError, DomainError, NotFoundError

router = APIRouter(prefix="/admin/inquiries", tags=["admin-inquiries"])

DEFAULT_PAGE_LIMIT = 20
MAX_PAGE_LIMIT = 100


def _filters(
    *,
    status: InquiryStatusFilter,
    category: InquiryCategoryFilter,
    start_date: date | None,
    end_date: date | None,
    q: str | None,
) -> list[ColumnElement[bool]]:
    filters: list[ColumnElement[bool]] = []
    if status != "all":
        filters.append(Inquiry.status == status)
    if category != "all":
        filters.append(Inquiry.category == category)
    start_at, end_at = kst_day_bounds(start_date, end_date)
    if start_at is not None:
        filters.append(Inquiry.created_at >= start_at)
    if end_at is not None:
        filters.append(Inquiry.created_at < end_at)
    if q is not None:
        search = q.strip()
        if len(search) < 2:
            raise DomainError("검색어는 2자 이상이어야 합니다", code="search_too_short")
        filters.append(
            Inquiry.title.icontains(search, autoescape=True)
            | Inquiry.content.icontains(search, autoescape=True)
        )
    return filters


def _sort(sort: InquirySort, direction: SortDirection) -> tuple[Any, Any]:
    column = {
        "created_at": Inquiry.created_at,
        "updated_at": Inquiry.updated_at,
        "status": Inquiry.status,
    }[sort]
    if direction == "asc":
        return column.asc(), Inquiry.id.asc()
    return column.desc(), Inquiry.id.desc()


def _summary(
    inquiry: Inquiry, customer: User | None, product: Product | None
) -> AdminInquirySummaryOut:
    return AdminInquirySummaryOut(
        id=inquiry.id,
        category=inquiry.category,
        title=inquiry.title,
        status=inquiry.status,
        is_secret=inquiry.is_secret,
        answer_date=inquiry.answer_date,
        created_at=inquiry.created_at,
        updated_at=inquiry.updated_at,
        customer=(
            AdminInquiryCustomerOut(
                id=customer.id,
                email=customer.email,
                name=customer.name,
                phone=customer.phone,
            )
            if customer is not None
            else None
        ),
        product=(
            AdminInquiryProductOut(id=product.id, code=product.code, name=product.name)
            if product is not None
            else None
        ),
    )


def _projection():
    return (
        select(Inquiry, User, Product)
        .outerjoin(User, User.id == Inquiry.user_id)
        .outerjoin(Product, Product.id == Inquiry.product_id)
    )


async def _page(
    session: AsyncSession,
    *,
    status: InquiryStatusFilter,
    category: InquiryCategoryFilter,
    start_date: date | None,
    end_date: date | None,
    q: str | None,
    sort: InquirySort,
    direction: SortDirection,
    limit: int,
    offset: int,
) -> Page[AdminInquirySummaryOut]:
    filters = _filters(
        status=status,
        category=category,
        start_date=start_date,
        end_date=end_date,
        q=q,
    )
    total = int(await session.scalar(select(func.count(Inquiry.id)).where(*filters)) or 0)
    rows = (
        await session.execute(
            _projection()
            .where(*filters)
            .order_by(*_sort(sort, direction))
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Page(
        items=[_summary(inquiry, customer, product) for inquiry, customer, product in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


async def get_inquiry_detail(session: AsyncSession, inquiry_id: uuid.UUID) -> AdminInquiryDetailOut:
    row = (await session.execute(_projection().where(Inquiry.id == inquiry_id))).one_or_none()
    if row is None:
        raise NotFoundError("문의를 찾을 수 없습니다")
    inquiry, customer, product = row
    summary = _summary(inquiry, customer, product)
    actor = (
        await session.get(User, inquiry.answered_by) if inquiry.answered_by is not None else None
    )
    return AdminInquiryDetailOut(
        **summary.model_dump(),
        content=inquiry.content,
        answer=inquiry.answer,
        answered_by=inquiry.answered_by,
        answer_actor=(
            AdminInquiryActorOut(id=actor.id, email=actor.email, name=actor.name)
            if actor is not None
            else None
        ),
    )


@router.get("", response_model=Page[AdminInquirySummaryOut])
async def list_admin_inquiries(
    session: SessionDep,
    admin: AdminUser,
    status: InquiryStatusFilter = "all",
    category: InquiryCategoryFilter = "all",
    start_date: date | None = None,
    end_date: date | None = None,
    sort: InquirySort = "created_at",
    direction: SortDirection = "desc",
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdminInquirySummaryOut]:
    return await _page(
        session,
        status=status,
        category=category,
        start_date=start_date,
        end_date=end_date,
        q=None,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
    )


@router.post("/search", response_model=Page[AdminInquirySummaryOut])
async def search_admin_inquiries(
    body: AdminInquirySearchRequest,
    session: SessionDep,
    admin: AdminUser,
) -> Page[AdminInquirySummaryOut]:
    return await _page(session, **body.model_dump())


@router.get("/{inquiry_id}", response_model=AdminInquiryDetailOut)
async def get_admin_inquiry(
    inquiry_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> AdminInquiryDetailOut:
    return await get_inquiry_detail(session, inquiry_id)


@router.post("/{inquiry_id}/answer", response_model=AdminInquiryDetailOut)
async def answer_admin_inquiry(
    inquiry_id: uuid.UUID,
    body: AdminInquiryAnswerRequest,
    session: SessionDep,
    admin: AdminUser,
) -> AdminInquiryDetailOut:
    inquiry = await session.scalar(
        select(Inquiry).where(Inquiry.id == inquiry_id).with_for_update()
    )
    if inquiry is None:
        raise NotFoundError("문의를 찾을 수 없습니다")
    if inquiry.updated_at != body.expected_updated_at:
        raise ConflictError(
            "다른 관리자가 문의를 먼저 변경했습니다. 최신 내용을 다시 확인해 주세요.",
            code="stale_inquiry",
        )
    answer = body.answer.strip()
    if not answer:
        raise DomainError("답변을 입력해 주세요", code="invalid_answer", status=422)
    inquiry.answer = answer
    inquiry.answer_date = datetime.now(UTC)
    inquiry.answered_by = admin.id
    inquiry.status = "답변완료"
    await session.commit()
    return await get_inquiry_detail(session, inquiry.id)
