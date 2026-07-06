"""관리자 — 쿠폰 관리·통계·고객/주문 목록 (domains.md §10)."""

import uuid
from datetime import date, datetime, timedelta
from typing import Any, Literal, cast
from zoneinfo import ZoneInfo

from db.models.auth import User
from db.models.commerce import Coupon, Order, UserCoupon
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy import CursorResult, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.db import SessionDep
from api.deps import AdminUser
from api.domains.coupons.schemas import CouponOut
from api.domains.orders.schemas import OrderOut
from api.domains.orders.status_machine import admin_actions
from api.errors import DomainError

router = APIRouter(prefix="/admin", tags=["admin"])

KST = ZoneInfo("Asia/Seoul")
OrderTypeFilter = Literal["all", "sale", "custom", "repair", "token", "sample"]


class CouponCreateRequest(BaseModel):
    name: str
    discount_type: Literal["percentage", "fixed"]
    discount_value: int
    expiry_date: date
    max_discount_amount: int | None = None
    description: str | None = None
    display_name: str | None = None


class CouponIssueRequest(BaseModel):
    user_ids: list[uuid.UUID]


class AffectedResponse(BaseModel):
    success: bool = True
    affected_count: int


class RevokeByIdsRequest(BaseModel):
    user_coupon_ids: list[uuid.UUID]


class StatsResponse(BaseModel):
    order_count: int
    revenue: int


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None
    name: str
    phone: str | None
    role: str
    is_active: bool
    phone_verified: bool
    created_at: datetime


class AdminOrderOut(OrderOut):
    admin_actions: list[str] = []


@router.post("/coupons", response_model=CouponOut, status_code=201)
async def create_coupon(
    body: CouponCreateRequest, session: SessionDep, admin: AdminUser
) -> CouponOut:
    coupon = Coupon(**body.model_dump())
    session.add(coupon)
    await session.commit()
    await session.refresh(coupon)
    return CouponOut.model_validate(coupon)


@router.get("/coupons", response_model=list[CouponOut])
async def list_coupons(session: SessionDep, admin: AdminUser) -> list[CouponOut]:
    rows = await session.scalars(select(Coupon).order_by(Coupon.created_at.desc()))
    return [CouponOut.model_validate(c) for c in rows]


@router.post("/coupons/{coupon_id}/issue", response_model=AffectedResponse)
async def bulk_issue_coupons(
    coupon_id: uuid.UUID, body: CouponIssueRequest, session: SessionDep, admin: AdminUser
) -> AffectedResponse:
    """일괄 발급 — 이미 보유한 유저는 재활성화(upsert)."""
    if not body.user_ids:
        return AffectedResponse(affected_count=0)
    if await session.get(Coupon, coupon_id) is None:
        raise DomainError("Coupon not found", code="coupon_not_found", status=404)
    affected = 0
    for user_id in set(body.user_ids):
        result = await session.execute(
            pg_insert(UserCoupon)
            .values(user_id=user_id, coupon_id=coupon_id, status="active")
            .on_conflict_do_update(
                index_elements=[UserCoupon.user_id, UserCoupon.coupon_id],
                set_={"status": "active"},
            )
        )
        affected += cast("CursorResult[Any]", result).rowcount
    await session.commit()
    return AffectedResponse(affected_count=affected)


@router.post("/coupons/revoke", response_model=AffectedResponse)
async def revoke_coupons_by_ids(
    body: RevokeByIdsRequest, session: SessionDep, admin: AdminUser
) -> AffectedResponse:
    """회수 — active 상태만 revoked로."""
    if not body.user_coupon_ids:
        return AffectedResponse(affected_count=0)
    result = await session.execute(
        update(UserCoupon)
        .where(UserCoupon.id.in_(body.user_coupon_ids), UserCoupon.status == "active")
        .values(status="revoked")
    )
    await session.commit()
    return AffectedResponse(affected_count=cast("CursorResult[Any]", result).rowcount)


@router.post("/coupons/{coupon_id}/revoke-users", response_model=AffectedResponse)
async def revoke_coupons_by_users(
    coupon_id: uuid.UUID, body: CouponIssueRequest, session: SessionDep, admin: AdminUser
) -> AffectedResponse:
    if not body.user_ids:
        return AffectedResponse(affected_count=0)
    result = await session.execute(
        update(UserCoupon)
        .where(
            UserCoupon.coupon_id == coupon_id,
            UserCoupon.user_id.in_(body.user_ids),
            UserCoupon.status == "active",
        )
        .values(status="revoked")
    )
    await session.commit()
    return AffectedResponse(affected_count=cast("CursorResult[Any]", result).rowcount)


def _apply_type_filter(query, order_type: OrderTypeFilter):
    if order_type != "all":
        query = query.where(Order.order_type == order_type)
    return query


@router.get("/stats/today", response_model=StatsResponse)
async def today_stats(
    session: SessionDep,
    admin: AdminUser,
    stat_date: date,
    order_type: OrderTypeFilter = "all",
) -> StatsResponse:
    start = datetime.combine(stat_date, datetime.min.time(), tzinfo=KST)
    query = select(func.count(), func.coalesce(func.sum(Order.total_price), 0)).where(
        Order.created_at >= start, Order.created_at < start + timedelta(days=1)
    )
    count, revenue = (await session.execute(_apply_type_filter(query, order_type))).one()
    return StatsResponse(order_count=count, revenue=revenue)


@router.get("/stats/period", response_model=StatsResponse)
async def period_stats(
    session: SessionDep,
    admin: AdminUser,
    start_date: date,
    end_date: date,
    order_type: OrderTypeFilter = "all",
) -> StatsResponse:
    if start_date > end_date:
        raise DomainError("start_date must be before end_date", code="invalid_range")
    start = datetime.combine(start_date, datetime.min.time(), tzinfo=KST)
    end = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=KST)
    query = select(func.count(), func.coalesce(func.sum(Order.total_price), 0)).where(
        Order.created_at >= start, Order.created_at < end
    )
    count, revenue = (await session.execute(_apply_type_filter(query, order_type))).one()
    return StatsResponse(order_count=count, revenue=revenue)


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(session: SessionDep, admin: AdminUser) -> list[AdminUserOut]:
    rows = await session.scalars(select(User).order_by(User.created_at.desc()))
    return [AdminUserOut.model_validate(u) for u in rows]


@router.get("/orders", response_model=list[AdminOrderOut])
async def list_all_orders(
    session: SessionDep,
    admin: AdminUser,
    order_type: OrderTypeFilter = "all",
    status: str | None = None,
) -> list[AdminOrderOut]:
    query = _apply_type_filter(select(Order), order_type).order_by(Order.created_at.desc())
    if status:
        query = query.where(Order.status == status)
    orders = (await session.scalars(query)).all()
    results = []
    for order in orders:
        out = AdminOrderOut.model_validate(order)
        out.admin_actions = admin_actions(order.order_type, order.status)
        results.append(out)
    return results
