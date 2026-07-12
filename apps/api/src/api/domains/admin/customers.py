"""관리자 고객 조회 — customer 역할 고정, PII 검색은 body로만 받는다."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from db.models.auth import User
from db.models.commerce import Coupon, Order, UserCoupon
from db.models.tokens import DesignToken
from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select

from api.db import SessionDep
from api.deps import AdminUser
from api.domains.admin.schemas import Page
from api.domains.tokens import ledger
from api.errors import DomainError, NotFoundError

router = APIRouter(prefix="/admin/customers", tags=["admin-customers"])

CustomerStatus = Literal["all", "active", "inactive"]
CustomerSort = Literal["created_at", "name"]
SortDirection = Literal["asc", "desc"]
DEFAULT_LIMIT = 20
MAX_LIMIT = 100


class CustomerSearchRequest(BaseModel):
    q: str = Field(min_length=2, max_length=100)
    status: CustomerStatus = "all"
    sort: CustomerSort = "created_at"
    direction: SortDirection = "desc"
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class AdminCustomerSummaryOut(BaseModel):
    id: uuid.UUID
    email: str | None
    name: str
    phone: str | None
    is_active: bool
    phone_verified: bool
    created_at: datetime
    token_balance: int
    order_count: int
    active_coupon_count: int


class AdminCustomerDetailOut(AdminCustomerSummaryOut):
    birth: date | None
    notification_consent: bool
    notification_enabled: bool
    marketing_kakao_sms_consent: bool
    updated_at: datetime
    paid_token_balance: int
    bonus_token_balance: int


class AdminCustomerOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    order_number: str
    order_type: str
    status: str
    total_price: int
    created_at: datetime


class AdminCustomerCouponOut(BaseModel):
    id: uuid.UUID
    coupon_id: uuid.UUID
    status: str
    issued_at: datetime
    expires_at: datetime | None
    used_at: datetime | None
    terms_snapshot: dict | None
    coupon_name: str
    coupon_display_name: str | None


class AdminCustomerTokenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    amount: int
    type: str
    token_class: str
    description: str | None
    work_id: str | None
    source_order_id: uuid.UUID | None
    expires_at: datetime | None
    created_at: datetime


def _customer_filters(status: CustomerStatus):
    filters = [User.role == "customer"]
    if status == "active":
        filters.append(User.is_active.is_(True))
    elif status == "inactive":
        filters.append(User.is_active.is_(False))
    return filters


def _escape_like(value: str) -> str:
    clean = value.strip()
    if len(clean) < 2:
        raise DomainError("검색어는 2자 이상이어야 합니다", code="search_too_short")
    escaped = clean.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _summary_query(status: CustomerStatus, q: str | None = None):
    token_total = (
        select(func.coalesce(func.sum(DesignToken.amount), 0))
        .where(
            DesignToken.user_id == User.id,
            or_(DesignToken.expires_at.is_(None), DesignToken.expires_at > func.now()),
        )
        .correlate(User)
        .scalar_subquery()
    )
    order_count = (
        select(func.count(Order.id))
        .where(Order.user_id == User.id)
        .correlate(User)
        .scalar_subquery()
    )
    active_coupon_count = (
        select(func.count(UserCoupon.id))
        .where(
            UserCoupon.user_id == User.id,
            UserCoupon.status == "active",
            or_(UserCoupon.expires_at.is_(None), UserCoupon.expires_at > func.now()),
        )
        .correlate(User)
        .scalar_subquery()
    )
    query = select(
        User,
        token_total.label("token_balance"),
        order_count.label("order_count"),
        active_coupon_count.label("active_coupon_count"),
    ).where(*_customer_filters(status))
    if q is not None:
        pattern = _escape_like(q)
        query = query.where(
            or_(
                User.name.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
                User.phone.ilike(pattern, escape="\\"),
            )
        )
    return query


async def _customer_page(
    session,
    *,
    status: CustomerStatus,
    q: str | None,
    sort: CustomerSort,
    direction: SortDirection,
    limit: int,
    offset: int,
) -> Page[AdminCustomerSummaryOut]:
    query = _summary_query(status, q)
    total = int(await session.scalar(select(func.count()).select_from(query.subquery())) or 0)
    primary = User.created_at if sort == "created_at" else User.name
    ordering = primary.asc() if direction == "asc" else primary.desc()
    tie = User.id.asc() if direction == "asc" else User.id.desc()
    rows = (await session.execute(query.order_by(ordering, tie).limit(limit).offset(offset))).all()
    return Page(
        items=[
            AdminCustomerSummaryOut(
                id=user.id,
                email=user.email,
                name=user.name,
                phone=user.phone,
                is_active=user.is_active,
                phone_verified=user.phone_verified,
                created_at=user.created_at,
                token_balance=int(token_balance),
                order_count=int(order_count),
                active_coupon_count=int(active_coupon_count),
            )
            for user, token_balance, order_count, active_coupon_count in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("", response_model=Page[AdminCustomerSummaryOut])
async def list_admin_customers(
    session: SessionDep,
    admin: AdminUser,
    status: CustomerStatus = "all",
    sort: CustomerSort = "created_at",
    direction: SortDirection = "desc",
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdminCustomerSummaryOut]:
    return await _customer_page(
        session,
        status=status,
        q=None,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
    )


@router.post("/search", response_model=Page[AdminCustomerSummaryOut])
async def search_admin_customers(
    body: CustomerSearchRequest, session: SessionDep, admin: AdminUser
) -> Page[AdminCustomerSummaryOut]:
    return await _customer_page(session, q=body.q, **body.model_dump(exclude={"q"}))


async def _customer_or_404(session, user_id: uuid.UUID) -> User:
    user = await session.scalar(select(User).where(User.id == user_id, User.role == "customer"))
    if user is None:
        raise NotFoundError("고객을 찾을 수 없습니다")
    return user


@router.get("/{user_id}", response_model=AdminCustomerDetailOut)
async def get_admin_customer(
    user_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> AdminCustomerDetailOut:
    user = await _customer_or_404(session, user_id)
    summary_row = (await session.execute(_summary_query("all").where(User.id == user.id))).one()
    _, token_total, order_count, active_coupon_count = summary_row
    balance = await ledger.get_balance(session, user.id)
    return AdminCustomerDetailOut(
        id=user.id,
        email=user.email,
        name=user.name,
        phone=user.phone,
        is_active=user.is_active,
        phone_verified=user.phone_verified,
        created_at=user.created_at,
        updated_at=user.updated_at,
        birth=user.birth,
        notification_consent=user.notification_consent,
        notification_enabled=user.notification_enabled,
        marketing_kakao_sms_consent=user.marketing_kakao_sms_consent,
        token_balance=int(token_total),
        paid_token_balance=balance["paid"],
        bonus_token_balance=balance["bonus"],
        order_count=int(order_count),
        active_coupon_count=int(active_coupon_count),
    )


@router.get("/{user_id}/orders", response_model=Page[AdminCustomerOrderOut])
async def list_admin_customer_orders(
    user_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdminCustomerOrderOut]:
    await _customer_or_404(session, user_id)
    base = select(Order).where(Order.user_id == user_id)
    total = int(await session.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows = await session.scalars(
        base.order_by(Order.created_at.desc(), Order.id.desc()).limit(limit).offset(offset)
    )
    return Page(
        items=[AdminCustomerOrderOut.model_validate(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{user_id}/coupons", response_model=Page[AdminCustomerCouponOut])
async def list_admin_customer_coupons(
    user_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdminCustomerCouponOut]:
    await _customer_or_404(session, user_id)
    base = (
        select(UserCoupon, Coupon)
        .join(Coupon, Coupon.id == UserCoupon.coupon_id)
        .where(UserCoupon.user_id == user_id)
    )
    total = int(await session.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows = (
        await session.execute(
            base.order_by(UserCoupon.issued_at.desc(), UserCoupon.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Page(
        items=[
            AdminCustomerCouponOut(
                id=user_coupon.id,
                coupon_id=user_coupon.coupon_id,
                status=user_coupon.status,
                issued_at=user_coupon.issued_at,
                expires_at=user_coupon.expires_at,
                used_at=user_coupon.used_at,
                terms_snapshot=user_coupon.terms_snapshot,
                coupon_name=coupon.name,
                coupon_display_name=coupon.display_name,
            )
            for user_coupon, coupon in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{user_id}/tokens", response_model=Page[AdminCustomerTokenOut])
async def list_admin_customer_tokens(
    user_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdminCustomerTokenOut]:
    await _customer_or_404(session, user_id)
    base = select(DesignToken).where(DesignToken.user_id == user_id)
    total = int(await session.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows = await session.scalars(
        base.order_by(DesignToken.created_at.desc(), DesignToken.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return Page(
        items=[AdminCustomerTokenOut.model_validate(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
