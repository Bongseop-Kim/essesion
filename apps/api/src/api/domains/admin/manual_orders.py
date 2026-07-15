"""수기 주문 — 무통장·전화 접수 종이 작업지시서 CRUD. 기존 주문 상태머신과 무관."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from db.models.commerce import ManualOrder
from fastapi import APIRouter, Query
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, or_, select

from api.db import SessionDep
from api.deps import AdminUser
from api.domains.admin.schemas import Page
from api.domains.reform.schemas import RestorationReform, WidthReform
from api.errors import ConflictError, NotFoundError

router = APIRouter(prefix="/admin/manual-orders", tags=["admin-manual-orders"])
DEFAULT_LIMIT = 20
MAX_LIMIT = 100


class ManualAutomaticSpec(BaseModel):
    """자동수선 — 종이 양식의 총장(cm)을 받는다(reform의 wearer_height_cm와 다름)."""

    model_config = ConfigDict(extra="forbid")

    mechanism: Literal["zipper", "string"]
    turn_knot: bool = False  # 마감: False=방, True=돌려묶기
    dimple: bool = False  # False=기본, True=딤플
    total_length_cm: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_turn_knot(self) -> "ManualAutomaticSpec":
        if self.mechanism == "string" and self.turn_knot:
            raise ValueError("끈 방식에서는 돌려묶기를 선택할 수 없습니다")
        return self


class ManualOrderItem(BaseModel):
    """품목 — automatic/width/restoration 존재 여부가 대분류 체크 상태."""

    model_config = ConfigDict(extra="forbid")

    quantity: int = Field(ge=1, le=999)
    automatic: ManualAutomaticSpec | None = None
    width: WidthReform | None = None
    restoration: RestorationReform | None = None
    note: str = Field(default="", max_length=500)  # 특이사항

    @model_validator(mode="after")
    def validate_category_selected(self) -> "ManualOrderItem":
        if self.automatic is None and self.width is None and self.restoration is None:
            raise ValueError("수선 대분류를 하나 이상 선택해주세요")
        return self


class ManualOrderCreateRequest(BaseModel):
    order_date: date
    customer_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=1, max_length=20)
    address: str | None = Field(default=None, max_length=500)
    amount: int = Field(ge=0)
    shipping_fee: int = Field(default=0, ge=0)
    is_received: bool = False
    is_paid: bool = False
    is_confirmed: bool = False
    items: list[ManualOrderItem] = Field(min_length=1, max_length=50)


class ManualOrderUpdateRequest(ManualOrderCreateRequest):
    expected_updated_at: AwareDatetime


class ManualOrderOut(BaseModel):
    id: uuid.UUID
    order_date: date
    customer_name: str
    phone: str
    address: str | None
    amount: int
    shipping_fee: int
    is_received: bool
    is_paid: bool
    is_confirmed: bool
    items: list[ManualOrderItem]
    created_at: datetime
    updated_at: datetime


def _out(row: ManualOrder) -> ManualOrderOut:
    return ManualOrderOut(
        id=row.id,
        order_date=row.order_date,
        customer_name=row.customer_name,
        phone=row.phone,
        address=row.address,
        amount=row.amount,
        shipping_fee=row.shipping_fee,
        is_received=row.is_received,
        is_paid=row.is_paid,
        is_confirmed=row.is_confirmed,
        items=[ManualOrderItem.model_validate(item) for item in row.items],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _manual_order_or_404(
    session, manual_order_id: uuid.UUID, *, lock: bool = False
) -> ManualOrder:
    query = select(ManualOrder).where(ManualOrder.id == manual_order_id)
    if lock:
        query = query.with_for_update()
    row = await session.scalar(query)
    if row is None:
        raise NotFoundError("수기 주문을 찾을 수 없습니다")
    return row


def _apply_body(row: ManualOrder, body: ManualOrderCreateRequest) -> None:
    values = body.model_dump(exclude={"expected_updated_at", "items"})
    for key, value in values.items():
        setattr(row, key, value)
    row.items = [item.model_dump(mode="json") for item in body.items]


@router.get("", response_model=Page[ManualOrderOut])
async def list_manual_orders(
    session: SessionDep,
    admin: AdminUser,
    q: Annotated[str | None, Query(max_length=64)] = None,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ManualOrderOut]:
    query = select(ManualOrder)
    if q:
        pattern = f"%{q.strip()}%"
        query = query.where(
            or_(ManualOrder.customer_name.ilike(pattern), ManualOrder.phone.ilike(pattern))
        )
    if start_date is not None:
        query = query.where(ManualOrder.order_date >= start_date)
    if end_date is not None:
        query = query.where(ManualOrder.order_date <= end_date)
    total = int(await session.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = await session.scalars(
        query.order_by(ManualOrder.order_date.desc(), ManualOrder.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return Page(items=[_out(row) for row in rows], total=total, limit=limit, offset=offset)


@router.post("", response_model=ManualOrderOut, status_code=201)
async def create_manual_order(
    body: ManualOrderCreateRequest, session: SessionDep, admin: AdminUser
) -> ManualOrderOut:
    row = ManualOrder()
    _apply_body(row, body)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _out(row)


@router.get("/{manual_order_id}", response_model=ManualOrderOut)
async def get_manual_order(
    manual_order_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> ManualOrderOut:
    return _out(await _manual_order_or_404(session, manual_order_id))


@router.put("/{manual_order_id}", response_model=ManualOrderOut)
async def update_manual_order(
    manual_order_id: uuid.UUID,
    body: ManualOrderUpdateRequest,
    session: SessionDep,
    admin: AdminUser,
) -> ManualOrderOut:
    row = await _manual_order_or_404(session, manual_order_id, lock=True)
    if row.updated_at != body.expected_updated_at:
        raise ConflictError("수기 주문이 다른 관리자에 의해 변경되었습니다", code="stale_resource")
    _apply_body(row, body)
    await session.commit()
    await session.refresh(row)
    return _out(row)


@router.delete("/{manual_order_id}", status_code=204)
async def delete_manual_order(
    manual_order_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> None:
    row = await _manual_order_or_404(session, manual_order_id)
    await session.delete(row)
    await session.commit()
