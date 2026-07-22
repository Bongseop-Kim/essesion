"""관리자 쿠폰 정의·고객군 preview·멱등 일괄 발급/회수."""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated, Any, Literal, Never, cast
from zoneinfo import ZoneInfo

from db.models.auth import User
from db.models.commerce import Coupon, Order, UserCoupon
from fastapi import APIRouter, Query
from obs import request_id_var
from pydantic import AwareDatetime, BaseModel, Field, model_validator
from sqlalchemy import CursorResult, exists, extract, func, literal, or_, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from api.db import SessionDep
from api.deps import AdminOnly, AdminUser
from api.domains.admin.helpers import kst_day_bounds
from api.domains.admin.operations import idempotent_result, record_operation
from api.domains.admin.schemas import Page
from api.domains.admin.types import SortDirection
from api.errors import ConflictError, DomainError, NotFoundError

router = APIRouter(prefix="/admin/coupons", tags=["admin-coupons"])
KST = ZoneInfo("Asia/Seoul")
DEFAULT_LIMIT = 20
MAX_LIMIT = 100
MIN_SEARCH_LENGTH = 2

CouponStatusFilter = Literal["all", "active", "inactive"]
CouponSort = Literal["created_at", "expiry_date", "name"]
AudienceSegment = Literal[
    "all",
    "new30",
    "birthdayThisMonth",
    "purchased",
    "notPurchased",
    "dormant",
]


class CouponCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    discount_type: Literal["percentage", "fixed"]
    discount_value: int = Field(gt=0)
    expiry_date: date
    max_discount_amount: int | None = Field(default=None, gt=0)
    description: str | None = Field(default=None, max_length=1000)
    display_name: str | None = Field(default=None, max_length=100)
    additional_info: str | None = Field(default=None, max_length=1000)
    is_active: bool = True


class CouponUpdateRequest(BaseModel):
    expected_updated_at: AwareDatetime
    name: str | None = Field(default=None, min_length=1, max_length=100)
    discount_type: Literal["percentage", "fixed"] | None = None
    discount_value: int | None = Field(default=None, gt=0)
    expiry_date: date | None = None
    max_discount_amount: int | None = Field(default=None, gt=0)
    description: str | None = Field(default=None, max_length=1000)
    display_name: str | None = Field(default=None, max_length=100)
    additional_info: str | None = Field(default=None, max_length=1000)
    is_active: bool | None = None


class AdminCouponOut(BaseModel):
    id: uuid.UUID
    name: str
    display_name: str | None
    discount_type: str
    discount_value: Decimal
    max_discount_amount: Decimal | None
    description: str | None
    expiry_date: date
    additional_info: str | None
    is_active: bool
    issued_count: int
    active_issued_count: int
    created_at: datetime
    updated_at: datetime


class CouponAudienceRequest(BaseModel):
    segment: AudienceSegment = "all"
    exclude_issued: bool = True
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class CouponAudienceCustomerOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str | None
    phone: str | None
    created_at: datetime


class CouponIssueRequest(BaseModel):
    operation_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=500)
    segment: AudienceSegment | None = None
    user_ids: list[uuid.UUID] | None = Field(default=None, max_length=10_000)
    exclude_issued: bool = True
    expected_count: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_target(self) -> "CouponIssueRequest":
        if (self.segment is None) == (self.user_ids is None):
            raise ValueError("segment 또는 user_ids 중 하나만 지정해야 합니다")
        if self.user_ids is not None and not self.user_ids:
            raise ValueError("user_ids는 비어 있을 수 없습니다")
        if self.segment is not None and self.expected_count is None:
            raise ValueError("고객군 발급에는 미리보기 인원수가 필요합니다")
        return self


class CouponRevokeRequest(BaseModel):
    operation_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=500)
    user_coupon_ids: list[uuid.UUID] = Field(min_length=1, max_length=10_000)


class CouponRevokeUsersRequest(BaseModel):
    operation_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=500)
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=10_000)


class AffectedResponse(BaseModel):
    success: bool = True
    affected_count: int
    operation_id: uuid.UUID


class IssuedCouponOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str
    user_email: str | None
    user_phone: str | None
    status: str
    issued_at: datetime
    expires_at: datetime | None
    used_at: datetime | None
    terms_snapshot: dict[str, Any]


def _validate_terms(
    discount_type: str,
    discount_value: int | Decimal,
    max_discount_amount: int | Decimal | None,
    expiry_date: date,
) -> None:
    if discount_type == "percentage" and not 1 <= int(discount_value) <= 100:
        raise DomainError(
            "퍼센트 할인율은 1에서 100 사이여야 합니다",
            code="invalid_discount_value",
        )
    if int(discount_value) <= 0:
        raise DomainError("할인 금액은 0보다 커야 합니다", code="invalid_discount_value")
    if discount_type == "fixed" and max_discount_amount is not None:
        raise DomainError(
            "고정 금액 쿠폰에는 최대 할인액을 설정할 수 없습니다",
            code="invalid_max_discount",
        )
    if max_discount_amount is not None and int(max_discount_amount) <= 0:
        raise DomainError("최대 할인액은 0보다 커야 합니다", code="invalid_max_discount")
    if expiry_date < datetime.now(KST).date():
        raise DomainError("만료일은 오늘보다 빠를 수 없습니다", code="invalid_expiry_date")


def _normalized_coupon_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise DomainError("쿠폰 이름을 입력해 주세요", code="invalid_coupon_name", status=422)
    return name


async def _raise_coupon_integrity_error(session, exc: IntegrityError) -> Never:
    await session.rollback()
    if "coupons_name_key" in str(exc.orig) or "uq_coupons_name" in str(exc.orig):
        raise ConflictError("이미 사용 중인 쿠폰 이름입니다", code="coupon_name_conflict") from exc
    raise ConflictError("쿠폰 저장 중 데이터 충돌이 발생했습니다") from exc


def _snapshot(coupon: Coupon) -> dict[str, Any]:
    return {
        "name": coupon.name,
        "display_name": coupon.display_name,
        "discount_type": coupon.discount_type,
        "discount_value": str(coupon.discount_value),
        "max_discount_amount": (
            str(coupon.max_discount_amount) if coupon.max_discount_amount is not None else None
        ),
        "description": coupon.description,
        "expiry_date": coupon.expiry_date.isoformat(),
        "additional_info": coupon.additional_info,
    }


async def _coupon_or_404(session, coupon_id: uuid.UUID, *, lock: bool = False) -> Coupon:
    query = select(Coupon).where(Coupon.id == coupon_id)
    if lock:
        query = query.with_for_update()
    coupon = await session.scalar(query)
    if coupon is None:
        raise NotFoundError("쿠폰을 찾을 수 없습니다")
    return coupon


def _coupon_projection():
    issued_count = (
        select(func.count(UserCoupon.id))
        .where(UserCoupon.coupon_id == Coupon.id)
        .correlate(Coupon)
        .scalar_subquery()
    )
    active_count = (
        select(func.count(UserCoupon.id))
        .where(
            UserCoupon.coupon_id == Coupon.id,
            UserCoupon.status == "active",
            or_(UserCoupon.expires_at.is_(None), UserCoupon.expires_at > func.now()),
        )
        .correlate(Coupon)
        .scalar_subquery()
    )
    return select(Coupon, issued_count, active_count)


def _coupon_out(coupon: Coupon, issued_count: int, active_count: int) -> AdminCouponOut:
    return AdminCouponOut(
        id=coupon.id,
        name=coupon.name,
        display_name=coupon.display_name,
        discount_type=coupon.discount_type,
        discount_value=coupon.discount_value,
        max_discount_amount=coupon.max_discount_amount,
        description=coupon.description,
        expiry_date=coupon.expiry_date,
        additional_info=coupon.additional_info,
        is_active=coupon.is_active,
        issued_count=int(issued_count),
        active_issued_count=int(active_count),
        created_at=coupon.created_at,
        updated_at=coupon.updated_at,
    )


async def _get_coupon_out(session, coupon_id: uuid.UUID) -> AdminCouponOut:
    row = (await session.execute(_coupon_projection().where(Coupon.id == coupon_id))).one_or_none()
    if row is None:
        raise NotFoundError("쿠폰을 찾을 수 없습니다")
    return _coupon_out(*row)


@router.get("", response_model=Page[AdminCouponOut])
async def list_admin_coupons(
    session: SessionDep,
    admin: AdminUser,
    status: CouponStatusFilter = "all",
    q: Annotated[str | None, Query(max_length=100)] = None,
    start_date: date | None = None,
    end_date: date | None = None,
    sort: CouponSort = "created_at",
    direction: SortDirection = "desc",
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdminCouponOut]:
    filters = []
    if status == "active":
        filters.append(Coupon.is_active.is_(True))
    elif status == "inactive":
        filters.append(Coupon.is_active.is_(False))
    if q is not None and (search := q.strip()):
        if len(search) < MIN_SEARCH_LENGTH:
            raise DomainError(
                f"Search query must be at least {MIN_SEARCH_LENGTH} characters",
                code="invalid_search",
            )
        name_filter = or_(
            Coupon.name.icontains(search, autoescape=True),
            Coupon.display_name.icontains(search, autoescape=True),
        )
        try:
            coupon_id = uuid.UUID(search)
        except ValueError:
            filters.append(name_filter)
        else:
            filters.append(or_(Coupon.id == coupon_id, name_filter))
    start_at, end_at = kst_day_bounds(start_date, end_date)
    if start_at is not None:
        filters.append(Coupon.created_at >= start_at)
    if end_at is not None:
        filters.append(Coupon.created_at < end_at)
    query = _coupon_projection().where(*filters)
    count_query = select(func.count()).select_from(query.order_by(None).subquery())
    total = int(await session.scalar(count_query) or 0)
    primary = {
        "created_at": Coupon.created_at,
        "expiry_date": Coupon.expiry_date,
        "name": Coupon.name,
    }[sort]
    ordering = primary.asc() if direction == "asc" else primary.desc()
    tie = Coupon.id.asc() if direction == "asc" else Coupon.id.desc()
    rows = (await session.execute(query.order_by(ordering, tie).limit(limit).offset(offset))).all()
    return Page(
        items=[_coupon_out(*row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=AdminCouponOut, status_code=201)
async def create_admin_coupon(
    body: CouponCreateRequest, session: SessionDep, admin: AdminUser
) -> AdminCouponOut:
    _validate_terms(
        body.discount_type,
        body.discount_value,
        body.max_discount_amount,
        body.expiry_date,
    )
    values = body.model_dump()
    values["name"] = _normalized_coupon_name(body.name)
    coupon = Coupon(**values)
    session.add(coupon)
    try:
        await session.commit()
    except IntegrityError as exc:
        await _raise_coupon_integrity_error(session, exc)
    return await _get_coupon_out(session, coupon.id)


@router.get("/{coupon_id}", response_model=AdminCouponOut)
async def get_admin_coupon(
    coupon_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> AdminCouponOut:
    return await _get_coupon_out(session, coupon_id)


@router.patch("/{coupon_id}", response_model=AdminCouponOut)
async def update_admin_coupon(
    coupon_id: uuid.UUID,
    body: CouponUpdateRequest,
    session: SessionDep,
    admin: AdminUser,
) -> AdminCouponOut:
    coupon = await _coupon_or_404(session, coupon_id, lock=True)
    if coupon.updated_at != body.expected_updated_at:
        raise ConflictError(
            "쿠폰이 다른 관리자에 의해 변경되었습니다",
            code="stale_resource",
        )
    changes = body.model_dump(exclude={"expected_updated_at"}, exclude_unset=True)
    for key, value in changes.items():
        setattr(coupon, key, _normalized_coupon_name(value) if key == "name" else value)
    _validate_terms(
        coupon.discount_type,
        coupon.discount_value,
        coupon.max_discount_amount,
        coupon.expiry_date,
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await _raise_coupon_integrity_error(session, exc)
    return await _get_coupon_out(session, coupon.id)


def _audience_query(
    coupon_id: uuid.UUID,
    *,
    segment: AudienceSegment,
    exclude_issued: bool,
    explicit_user_ids: list[uuid.UUID] | None = None,
):
    query = select(User).where(User.role == "customer", User.is_active.is_(True))
    if explicit_user_ids is not None:
        query = query.where(User.id.in_(set(explicit_user_ids)))
    completed_order = exists().where(
        Order.user_id == User.id,
        Order.status == "완료",
    )
    now = datetime.now(UTC)
    if segment == "new30":
        query = query.where(User.created_at >= now - timedelta(days=30))
    elif segment == "birthdayThisMonth":
        query = query.where(extract("month", User.birth) == datetime.now(KST).month)
    elif segment == "purchased":
        query = query.where(completed_order)
    elif segment == "notPurchased":
        query = query.where(~completed_order)
    elif segment == "dormant":
        latest_completed = (
            select(func.max(Order.created_at))
            .where(Order.user_id == User.id, Order.status == "완료")
            .correlate(User)
            .scalar_subquery()
        )
        query = query.where(latest_completed < now - timedelta(days=90))
    if exclude_issued:
        query = query.where(
            ~exists().where(
                UserCoupon.user_id == User.id,
                UserCoupon.coupon_id == coupon_id,
                UserCoupon.status.in_(("active", "used", "reserved")),
            )
        )
    return query


@router.post("/{coupon_id}/audience-preview", response_model=Page[CouponAudienceCustomerOut])
async def preview_coupon_audience(
    coupon_id: uuid.UUID,
    body: CouponAudienceRequest,
    session: SessionDep,
    admin: AdminUser,
) -> Page[CouponAudienceCustomerOut]:
    await _coupon_or_404(session, coupon_id)
    query = _audience_query(
        coupon_id,
        segment=body.segment,
        exclude_issued=body.exclude_issued,
    )
    total = int(await session.scalar(select(func.count()).select_from(query.subquery())) or 0)
    users = await session.scalars(
        query.order_by(User.created_at.desc(), User.id.desc()).limit(body.limit).offset(body.offset)
    )
    return Page(
        items=[
            CouponAudienceCustomerOut(
                id=user.id,
                name=user.name,
                email=user.email,
                phone=user.phone,
                created_at=user.created_at,
            )
            for user in users
        ],
        total=total,
        limit=body.limit,
        offset=body.offset,
    )


async def _issue(
    coupon_id: uuid.UUID,
    body: CouponIssueRequest,
    session,
    admin: User,
) -> AffectedResponse:
    payload = body.model_dump(mode="json", exclude={"operation_id"})
    if body.expected_count is None:
        # 직접 user_ids 발급의 기존 operation payload hash를 유지한다.
        payload.pop("expected_count")
    previous = await idempotent_result(
        session,
        operation_id=body.operation_id,
        action="coupon_issue",
        target_type="coupon",
        target_id=str(coupon_id),
        payload=payload,
    )
    if previous is not None:
        return AffectedResponse(
            affected_count=int(previous["affected_count"]),
            operation_id=body.operation_id,
        )

    coupon = await _coupon_or_404(session, coupon_id, lock=True)
    _validate_terms(
        coupon.discount_type,
        coupon.discount_value,
        coupon.max_discount_amount,
        coupon.expiry_date,
    )
    if not coupon.is_active:
        raise DomainError("비활성 쿠폰은 발급할 수 없습니다", code="coupon_inactive")

    segment = body.segment or "all"
    audience = _audience_query(
        coupon_id,
        segment=segment,
        exclude_issued=body.exclude_issued,
        explicit_user_ids=body.user_ids,
    )
    # 한 번 계산한 ID 집합을 발급에도 그대로 사용한다. count 쿼리 뒤 고객군을
    # 다시 평가하면 두 문장 사이의 변경으로 확인 인원과 실제 대상이 달라질 수 있다.
    target_user_ids = list(await session.scalars(audience.with_only_columns(User.id)))
    if body.expected_count is not None and len(target_user_ids) != body.expected_count:
        raise ConflictError(
            "미리보기 이후 쿠폰 대상 고객이 변경되었습니다",
            code="coupon_audience_changed",
        )
    target_users = select(User.id).where(User.id.in_(target_user_ids)).subquery()
    expires_at = datetime.combine(coupon.expiry_date + timedelta(days=1), time.min, tzinfo=KST)
    snapshot = _snapshot(coupon)
    insert = pg_insert(UserCoupon).from_select(
        [
            UserCoupon.user_id,
            UserCoupon.coupon_id,
            UserCoupon.status,
            UserCoupon.issued_at,
            UserCoupon.expires_at,
            UserCoupon.terms_snapshot,
        ],
        select(
            target_users.c.id,
            literal(coupon.id),
            literal("active"),
            func.now(),
            literal(expires_at),
            literal(snapshot, type_=JSONB),
        ),
    )
    result = await session.execute(
        insert.on_conflict_do_update(
            index_elements=[UserCoupon.user_id, UserCoupon.coupon_id],
            set_={
                "status": "active",
                "issued_at": func.now(),
                "expires_at": expires_at,
                "used_at": None,
                "terms_snapshot": snapshot,
                "updated_at": func.now(),
            },
            where=UserCoupon.status.in_(("revoked", "expired")),
        )
    )
    affected = cast("CursorResult[Any]", result).rowcount
    after = {"affected_count": affected}
    record_operation(
        session,
        operation_id=body.operation_id,
        actor_id=admin.id,
        action="coupon_issue",
        target_type="coupon",
        target_id=str(coupon.id),
        target_count=affected,
        reason=body.reason,
        payload=payload,
        before={"segment": segment},
        after=after,
        request_id=request_id_var.get(),
    )
    await session.commit()
    return AffectedResponse(
        affected_count=affected,
        operation_id=body.operation_id,
    )


@router.post("/{coupon_id}/issue", response_model=AffectedResponse)
async def issue_coupon(
    coupon_id: uuid.UUID,
    body: CouponIssueRequest,
    session: SessionDep,
    admin: AdminOnly,
) -> AffectedResponse:
    return await _issue(coupon_id, body, session, admin)


@router.post("/revoke", response_model=AffectedResponse)
async def revoke_coupons(
    body: CouponRevokeRequest, session: SessionDep, admin: AdminOnly
) -> AffectedResponse:
    ids = sorted({str(value) for value in body.user_coupon_ids})
    payload = {"ids": ids, "reason": body.reason}
    previous = await idempotent_result(
        session,
        operation_id=body.operation_id,
        action="coupon_revoke",
        target_type="user_coupon",
        target_id=None,
        payload=payload,
    )
    if previous is not None:
        return AffectedResponse(
            affected_count=int(previous["affected_count"]),
            operation_id=body.operation_id,
        )
    result = await session.execute(
        update(UserCoupon)
        .where(UserCoupon.id.in_(body.user_coupon_ids), UserCoupon.status == "active")
        .values(status="revoked")
    )
    affected = cast("CursorResult[Any]", result).rowcount
    after = {"affected_count": affected}
    record_operation(
        session,
        operation_id=body.operation_id,
        actor_id=admin.id,
        action="coupon_revoke",
        target_type="user_coupon",
        target_id=None,
        target_count=affected,
        reason=body.reason,
        payload=payload,
        before={"requested_count": len(ids)},
        after=after,
        request_id=request_id_var.get(),
    )
    await session.commit()
    return AffectedResponse(affected_count=affected, operation_id=body.operation_id)


@router.post("/{coupon_id}/revoke-users", response_model=AffectedResponse)
async def revoke_coupon_users(
    coupon_id: uuid.UUID,
    body: CouponRevokeUsersRequest,
    session: SessionDep,
    admin: AdminOnly,
) -> AffectedResponse:
    await _coupon_or_404(session, coupon_id)
    user_ids = sorted({str(value) for value in body.user_ids})
    payload = {"user_ids": user_ids, "reason": body.reason}
    previous = await idempotent_result(
        session,
        operation_id=body.operation_id,
        action="coupon_revoke_users",
        target_type="coupon",
        target_id=str(coupon_id),
        payload=payload,
    )
    if previous is not None:
        return AffectedResponse(
            affected_count=int(previous["affected_count"]),
            operation_id=body.operation_id,
        )
    result = await session.execute(
        update(UserCoupon)
        .where(
            UserCoupon.coupon_id == coupon_id,
            UserCoupon.user_id.in_(body.user_ids),
            UserCoupon.status == "active",
        )
        .values(status="revoked")
    )
    affected = cast("CursorResult[Any]", result).rowcount
    after = {"affected_count": affected}
    record_operation(
        session,
        operation_id=body.operation_id,
        actor_id=admin.id,
        action="coupon_revoke_users",
        target_type="coupon",
        target_id=str(coupon_id),
        target_count=affected,
        reason=body.reason,
        payload=payload,
        before={"requested_count": len(user_ids)},
        after=after,
        request_id=request_id_var.get(),
    )
    await session.commit()
    return AffectedResponse(affected_count=affected, operation_id=body.operation_id)


@router.get("/{coupon_id}/issued", response_model=Page[IssuedCouponOut])
async def list_issued_coupons(
    coupon_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    status: Literal["all", "active", "used", "expired", "revoked", "reserved"] = "all",
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[IssuedCouponOut]:
    await _coupon_or_404(session, coupon_id)
    query = (
        select(UserCoupon, User)
        .join(User, User.id == UserCoupon.user_id)
        .where(UserCoupon.coupon_id == coupon_id, User.role == "customer")
    )
    if status != "all":
        query = query.where(UserCoupon.status == status)
    total = int(await session.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = (
        await session.execute(
            query.order_by(UserCoupon.issued_at.desc(), UserCoupon.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Page(
        items=[
            IssuedCouponOut(
                id=user_coupon.id,
                user_id=user.id,
                user_name=user.name,
                user_email=user.email,
                user_phone=user.phone,
                status=user_coupon.status,
                issued_at=user_coupon.issued_at,
                expires_at=user_coupon.expires_at,
                used_at=user_coupon.used_at,
                terms_snapshot=user_coupon.terms_snapshot,
            )
            for user_coupon, user in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )
