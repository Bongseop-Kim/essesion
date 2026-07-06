import uuid
from typing import Literal

from db.models.commerce import Claim, Order, OrderItem
from fastapi import APIRouter
from sqlalchemy import select

from api.db import SessionDep
from api.deps import AdminUser, CurrentUser, ensure_owner
from api.domains.orders import service
from api.domains.orders.schemas import (
    AdminStatusUpdateRequest,
    AdminStatusUpdateResponse,
    AdminTrackingUpdateRequest,
    CustomAmountRequest,
    CustomAmountResponse,
    CustomOrderCreateRequest,
    OrderCreateRequest,
    OrderCreateResponse,
    OrderItemOut,
    OrderOut,
    RepairNoTrackingRequest,
    RepairTrackingRequest,
    SampleOrderCreateRequest,
    SingleOrderCreateResponse,
)
from api.domains.orders.status_machine import ACTIVE_CLAIM_STATUSES, customer_actions

router = APIRouter(tags=["orders"])


@router.post("/orders", response_model=OrderCreateResponse, status_code=201)
async def create_order(
    body: OrderCreateRequest, session: SessionDep, user: CurrentUser
) -> OrderCreateResponse:
    return OrderCreateResponse(**await service.create_order(session, user, body))


@router.post("/orders/custom/calculate", response_model=CustomAmountResponse)
async def calculate_custom_order(
    body: CustomAmountRequest, session: SessionDep
) -> CustomAmountResponse:
    """맞춤 주문 금액 계산 — 공개(리소스 접근 없음, 비로그인 견적 UX)."""
    return CustomAmountResponse(
        **await service.calculate_custom_amounts(session, body.options, body.quantity)
    )


@router.post("/orders/custom", response_model=SingleOrderCreateResponse, status_code=201)
async def create_custom_order(
    body: CustomOrderCreateRequest, session: SessionDep, user: CurrentUser
) -> SingleOrderCreateResponse:
    return SingleOrderCreateResponse(**await service.create_custom_order(session, user, body))


@router.post("/orders/sample", response_model=SingleOrderCreateResponse, status_code=201)
async def create_sample_order(
    body: SampleOrderCreateRequest, session: SessionDep, user: CurrentUser
) -> SingleOrderCreateResponse:
    return SingleOrderCreateResponse(**await service.create_sample_order(session, user, body))


async def _active_claim_order_ids(session, order_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not order_ids:
        return set()
    rows = await session.scalars(
        select(Claim.order_id).where(
            Claim.order_id.in_(order_ids), Claim.status.in_(ACTIVE_CLAIM_STATUSES)
        )
    )
    return set(rows)


@router.get("/orders", response_model=list[OrderOut])
async def list_my_orders(
    session: SessionDep,
    user: CurrentUser,
    order_type: Literal["sale", "custom", "repair", "token", "sample"] | None = None,
) -> list[OrderOut]:
    query = (
        select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc())
    )
    if order_type:
        query = query.where(Order.order_type == order_type)
    orders = (await session.scalars(query)).all()
    with_claims = await _active_claim_order_ids(session, [o.id for o in orders])
    results = []
    for order in orders:
        out = OrderOut.model_validate(order)
        out.customer_actions = customer_actions(
            order.order_type, order.status, has_active_claim=order.id in with_claims
        )
        results.append(out)
    return results


@router.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(order_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> OrderOut:
    order = await session.get(Order, order_id)
    ensure_owner(order, user)
    assert order is not None
    items = (
        await session.scalars(
            select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.created_at)
        )
    ).all()
    has_claim = bool(await _active_claim_order_ids(session, [order.id]))
    out = OrderOut.model_validate(order)
    out.items = [OrderItemOut.model_validate(i) for i in items]
    out.customer_actions = customer_actions(
        order.order_type, order.status, has_active_claim=has_claim
    )
    return out


@router.post("/orders/{order_id}/confirm-purchase", response_model=OrderOut)
async def confirm_purchase(
    order_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> OrderOut:
    return OrderOut.model_validate(await service.confirm_purchase(session, user, order_id))


@router.post("/orders/{order_id}/repair-tracking", response_model=OrderOut)
async def submit_repair_tracking(
    order_id: uuid.UUID, body: RepairTrackingRequest, session: SessionDep, user: CurrentUser
) -> OrderOut:
    return OrderOut.model_validate(
        await service.submit_repair_tracking(session, user, order_id, body)
    )


@router.post("/orders/{order_id}/repair-no-tracking", response_model=OrderOut)
async def submit_repair_no_tracking(
    order_id: uuid.UUID, body: RepairNoTrackingRequest, session: SessionDep, user: CurrentUser
) -> OrderOut:
    return OrderOut.model_validate(
        await service.submit_repair_no_tracking(session, user, order_id, body)
    )


# ---- 관리자 ----


@router.post("/admin/orders/{order_id}/status", response_model=AdminStatusUpdateResponse)
async def admin_update_order_status(
    order_id: uuid.UUID, body: AdminStatusUpdateRequest, session: SessionDep, admin: AdminUser
) -> AdminStatusUpdateResponse:
    result = await service.admin_update_status(
        session, admin, order_id, body.new_status, body.memo, body.is_rollback
    )
    return AdminStatusUpdateResponse(**result)


@router.post("/admin/orders/{order_id}/tracking", response_model=OrderOut)
async def admin_update_order_tracking(
    order_id: uuid.UUID, body: AdminTrackingUpdateRequest, session: SessionDep, admin: AdminUser
) -> OrderOut:
    order = await service.admin_update_tracking(
        session,
        order_id,
        courier_company=body.courier_company,
        tracking_number=body.tracking_number,
        company_courier_company=body.company_courier_company,
        company_tracking_number=body.company_tracking_number,
    )
    return OrderOut.model_validate(order)
