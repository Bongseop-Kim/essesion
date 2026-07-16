"""관리자 견적 조회·상태 전이와 관계 검증된 이미지 읽기."""

import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Any

from db.models.auth import User
from db.models.commerce import QuoteRequest, QuoteRequestStatusLog
from db.models.images import Image
from fastapi import APIRouter, Query, Request
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import SessionDep
from api.deps import AdminUser
from api.domains.admin.helpers import kst_day_bounds, resolve_shipping_address
from api.domains.admin.quote_schemas import (
    AdminQuoteAction,
    AdminQuoteActorOut,
    AdminQuoteDetailOut,
    AdminQuoteImageOut,
    AdminQuoteStatusLogOut,
    AdminQuoteStatusRequest,
    AdminQuoteSummaryOut,
    QuoteSort,
    QuoteStatus,
    QuoteStatusFilter,
    SignedReadUrlOut,
)
from api.domains.admin.schemas import AdminOrderCustomerOut, Page
from api.domains.admin.types import SortDirection
from api.domains.quotes import service
from api.errors import DomainError, NotFoundError

router = APIRouter(prefix="/admin/quotes", tags=["admin-quotes"])

DEFAULT_PAGE_LIMIT = 20
MAX_PAGE_LIMIT = 100
QUOTE_STATUSES: tuple[QuoteStatus, ...] = ("요청", "견적발송", "협의중", "확정", "종료")


def _actions(status: str) -> list[AdminQuoteAction]:
    actions: list[AdminQuoteAction] = []
    for target in QUOTE_STATUSES:
        if target == status:
            continue
        enabled = (status, target) in service.TRANSITIONS
        actions.append(
            AdminQuoteAction(
                target_status=target,
                label=f"{target}(으)로 변경",
                enabled=enabled,
                blocking_reason=None if enabled else "현재 상태에서는 전이할 수 없습니다.",
                destructive=target == "종료",
            )
        )
    return actions


def _customer(user: User) -> AdminOrderCustomerOut:
    return AdminOrderCustomerOut(id=user.id, email=user.email, name=user.name, phone=user.phone)


def _summary(quote: QuoteRequest, user: User) -> AdminQuoteSummaryOut:
    return AdminQuoteSummaryOut(
        id=quote.id,
        quote_number=quote.quote_number,
        status=quote.status,
        quantity=quote.quantity,
        business_name=quote.business_name,
        quoted_amount=quote.quoted_amount,
        created_at=quote.created_at,
        updated_at=quote.updated_at,
        customer=_customer(user),
        admin_actions=_actions(quote.status),
    )


def _date_filters(start_date: date | None, end_date: date | None) -> list[ColumnElement[bool]]:
    if start_date is not None and end_date is not None and start_date > end_date:
        raise DomainError("시작일은 종료일보다 늦을 수 없습니다", code="invalid_range")
    start_at, end_at = kst_day_bounds(start_date, end_date)
    filters: list[ColumnElement[bool]] = []
    if start_at is not None:
        filters.append(QuoteRequest.created_at >= start_at)
    if end_at is not None:
        filters.append(QuoteRequest.created_at < end_at)
    return filters


def _filters(
    status: QuoteStatusFilter,
    start_date: date | None,
    end_date: date | None,
    q: str | None,
) -> list[ColumnElement[bool]]:
    filters = _date_filters(start_date, end_date)
    if status != "all":
        filters.append(QuoteRequest.status == status)
    if q is not None:
        search = q.strip()
        if len(search) < 2:
            raise DomainError("검색어는 2자 이상이어야 합니다", code="invalid_search")
        filters.append(QuoteRequest.quote_number.icontains(search, autoescape=True))
    return filters


def _sort(sort: QuoteSort, direction: SortDirection) -> tuple[Any, Any]:
    column = {
        "created_at": QuoteRequest.created_at,
        "updated_at": QuoteRequest.updated_at,
        "quote_number": QuoteRequest.quote_number,
        "status": QuoteRequest.status,
        "quoted_amount": QuoteRequest.quoted_amount,
    }[sort]
    if direction == "asc":
        return column.asc().nulls_last(), QuoteRequest.id.asc()
    return column.desc().nulls_last(), QuoteRequest.id.desc()


def _reference_keys(quote: QuoteRequest) -> list[str]:
    keys: list[str] = []
    for value in quote.reference_images or []:
        if isinstance(value, dict) and isinstance(key := value.get("object_key"), str):
            keys.append(key)
    return keys


async def _quote_images(session: AsyncSession, quote: QuoteRequest) -> list[AdminQuoteImageOut]:
    keys = _reference_keys(quote)
    if not keys:
        return []
    rows = list(
        await session.scalars(
            select(Image).where(
                Image.entity_type == "quote_request",
                Image.entity_id == str(quote.id),
                Image.object_key.in_(keys),
                Image.upload_completed_at.is_not(None),
                Image.deleted_at.is_(None),
            )
        )
    )
    by_key = {row.object_key: row for row in rows}
    return [
        AdminQuoteImageOut(
            id=image.id,
            content_type=image.content_type,
            size_bytes=image.size_bytes,
            created_at=image.created_at,
        )
        for key in keys
        if (image := by_key.get(key)) is not None
    ]


async def _status_logs(session: AsyncSession, quote_id: uuid.UUID) -> list[AdminQuoteStatusLogOut]:
    rows = (
        await session.execute(
            select(QuoteRequestStatusLog, User)
            .outerjoin(User, User.id == QuoteRequestStatusLog.changed_by)
            .where(QuoteRequestStatusLog.quote_request_id == quote_id)
            .order_by(QuoteRequestStatusLog.created_at, QuoteRequestStatusLog.id)
        )
    ).all()
    return [
        AdminQuoteStatusLogOut(
            id=log.id,
            changed_by=log.changed_by,
            previous_status=log.previous_status,
            new_status=log.new_status,
            memo=log.memo,
            request_id=log.request_id,
            created_at=log.created_at,
            actor=(
                AdminQuoteActorOut(id=actor.id, name=actor.name, email=actor.email)
                if actor is not None
                else None
            ),
        )
        for log, actor in rows
    ]


async def get_quote_detail(session: AsyncSession, quote_id: uuid.UUID) -> AdminQuoteDetailOut:
    row = (
        await session.execute(
            select(QuoteRequest, User)
            .join(User, User.id == QuoteRequest.user_id)
            .where(QuoteRequest.id == quote_id)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("견적을 찾을 수 없습니다")
    quote, user = row
    summary = _summary(quote, user)
    return AdminQuoteDetailOut(
        **summary.model_dump(),
        shipping_address_id=quote.shipping_address_id,
        shipping_address=await resolve_shipping_address(
            session, quote.shipping_address_snapshot, quote.shipping_address_id
        ),
        options=quote.options,
        additional_notes=quote.additional_notes,
        contact_name=quote.contact_name,
        contact_method=quote.contact_method,
        contact_value=quote.contact_value,
        quote_conditions=quote.quote_conditions,
        admin_memo=quote.admin_memo,
        images=await _quote_images(session, quote),
        status_logs=await _status_logs(session, quote.id),
    )


@router.get("", response_model=Page[AdminQuoteSummaryOut])
async def list_admin_quotes(
    session: SessionDep,
    admin: AdminUser,
    status: QuoteStatusFilter = "all",
    start_date: date | None = None,
    end_date: date | None = None,
    q: Annotated[str | None, Query(min_length=2, max_length=64)] = None,
    sort: QuoteSort = "created_at",
    direction: SortDirection = "desc",
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdminQuoteSummaryOut]:
    filters = _filters(status, start_date, end_date, q)
    total = int(await session.scalar(select(func.count(QuoteRequest.id)).where(*filters)) or 0)
    rows = (
        await session.execute(
            select(QuoteRequest, User)
            .join(User, User.id == QuoteRequest.user_id)
            .where(*filters)
            .order_by(*_sort(sort, direction))
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Page(
        items=[_summary(quote, user) for quote, user in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{quote_id}", response_model=AdminQuoteDetailOut)
async def get_admin_quote(
    quote_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> AdminQuoteDetailOut:
    return await get_quote_detail(session, quote_id)


@router.post("/{quote_id}/status", response_model=AdminQuoteDetailOut)
async def update_admin_quote_status(
    quote_id: uuid.UUID,
    body: AdminQuoteStatusRequest,
    session: SessionDep,
    admin: AdminUser,
) -> AdminQuoteDetailOut:
    await service.admin_update_status(
        session,
        admin,
        quote_id,
        expected_updated_at=body.expected_updated_at,
        new_status=body.new_status,
        quoted_amount=body.quoted_amount,
        quote_conditions=body.quote_conditions,
        admin_memo=body.admin_memo,
        memo=body.memo,
    )
    return await get_quote_detail(session, quote_id)


@router.post("/{quote_id}/images/{image_id}/read-url", response_model=SignedReadUrlOut)
async def create_admin_quote_image_read_url(
    quote_id: uuid.UUID,
    image_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> SignedReadUrlOut:
    quote = await session.get(QuoteRequest, quote_id)
    if quote is None:
        raise NotFoundError("견적을 찾을 수 없습니다")
    image = await session.scalar(
        select(Image).where(
            Image.id == image_id,
            Image.entity_type == "quote_request",
            Image.entity_id == str(quote.id),
            Image.object_key.in_(_reference_keys(quote)),
            Image.upload_completed_at.is_not(None),
            Image.deleted_at.is_(None),
        )
    )
    if image is None or not image.object_key.startswith(service.QUOTE_IMAGE_PREFIX):
        raise NotFoundError("견적 이미지를 찾을 수 없습니다")
    if image.expires_at is not None and image.expires_at <= datetime.now(UTC):
        raise DomainError("이미지가 만료되었습니다", code="image_expired")
    return SignedReadUrlOut(read_url=await request.app.state.gcs.signed_read_url(image.object_key))
