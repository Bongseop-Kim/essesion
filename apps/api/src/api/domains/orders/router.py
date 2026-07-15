import uuid
from typing import Literal

from db.models.commerce import Claim, Order, OrderItem, ShippingAddress
from fastapi import APIRouter, Request
from sqlalchemy import select

from api.db import SessionDep
from api.deps import AdminUser, CurrentUser, ensure_owner
from api.domains.orders import service
from api.domains.orders.schemas import (
    AdminStatusUpdateRequest,
    AdminStatusUpdateResponse,
    AdminTrackingUpdateRequest,
    ClaimBadgeOut,
    CustomAmountRequest,
    CustomAmountResponse,
    CustomOrderCreateRequest,
    OrderCreateRequest,
    OrderCreateResponse,
    OrderDetailOut,
    OrderItemOut,
    OrderOut,
    OrderShippingAddressOut,
    RepairNoTrackingRequest,
    RepairTrackingRequest,
    SampleAmountRequest,
    SampleAmountResponse,
    SampleOrderCreateRequest,
    SingleOrderCreateResponse,
)
from api.domains.orders.status_machine import customer_actions

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
    body: CustomOrderCreateRequest,
    session: SessionDep,
    user: CurrentUser,
    request: Request,
) -> SingleOrderCreateResponse:
    return SingleOrderCreateResponse(
        **await service.create_custom_order(session, user, body, request.app.state.gcs)
    )


@router.post("/orders/sample", response_model=SingleOrderCreateResponse, status_code=201)
async def create_sample_order(
    body: SampleOrderCreateRequest,
    session: SessionDep,
    user: CurrentUser,
    request: Request,
) -> SingleOrderCreateResponse:
    return SingleOrderCreateResponse(
        **await service.create_sample_order(session, user, body, request.app.state.gcs)
    )


@router.post("/orders/sample/calculate", response_model=SampleAmountResponse)
async def calculate_sample_order(
    body: SampleAmountRequest, session: SessionDep
) -> SampleAmountResponse:
    """샘플 주문 금액 계산 — 공개(주문·쿠폰 상태를 만들지 않음)."""
    return SampleAmountResponse(
        total_cost=await service.calculate_sample_amount(session, body.sample_type, body.options)
    )


@router.get("/orders", response_model=list[OrderOut])
async def list_my_orders(
    session: SessionDep,
    user: CurrentUser,
    order_type: Literal["sale", "custom", "repair", "token", "sample"] | None = None,
) -> list[OrderOut]:
    query = select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc())
    if order_type:
        query = query.where(Order.order_type == order_type)
    orders = (await session.scalars(query)).all()
    order_ids = [order.id for order in orders]
    claims = (
        (await session.scalars(select(Claim).where(Claim.order_id.in_(order_ids)))).all()
        if order_ids
        else []
    )
    claim_context = service.claim_read_model(claims)
    items_by_order: dict[uuid.UUID, list[OrderItemOut]] = {}
    if order_ids:
        items = await session.scalars(
            select(OrderItem)
            .where(OrderItem.order_id.in_(order_ids))
            .order_by(OrderItem.created_at)
        )
        for item in items:
            item_out = OrderItemOut.model_validate(item)
            item_claim = claim_context.by_item.get(item.id)
            if item_claim is not None:
                item_out.claim = ClaimBadgeOut.model_validate(item_claim)
            items_by_order.setdefault(item.order_id, []).append(item_out)
    results = []
    for order in orders:
        out = OrderOut.model_validate(order)
        out.items = items_by_order.get(order.id, [])
        summary_claim = claim_context.by_order.get(order.id)
        if summary_claim is not None:
            out.claim_summary = ClaimBadgeOut.model_validate(summary_claim)
        out.customer_actions = customer_actions(
            order.order_type,
            order.status,
            has_blocking_claim=(
                order.id in claim_context.active_order_ids
                or order.id in claim_context.completed_cancel_order_ids
            ),
        )
        results.append(out)
    return results


@router.get("/orders/{order_id}", response_model=OrderDetailOut)
async def get_order(order_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> OrderDetailOut:
    order = await session.get(Order, order_id)
    ensure_owner(order, user)
    assert order is not None
    items = (
        await session.scalars(
            select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.created_at)
        )
    ).all()
    claims = (await session.scalars(select(Claim).where(Claim.order_id == order.id))).all()
    claim_context = service.claim_read_model(claims)
    out = OrderDetailOut.model_validate(order)
    out.items = []
    for item in items:
        item_out = OrderItemOut.model_validate(item)
        item_claim = claim_context.by_item.get(item.id)
        if item_claim is not None:
            item_out.claim = ClaimBadgeOut.model_validate(item_claim)
        out.items.append(item_out)
    summary_claim = claim_context.by_order.get(order.id)
    if summary_claim is not None:
        out.claim_summary = ClaimBadgeOut.model_validate(summary_claim)
    if order.shipping_address_snapshot:
        out.shipping_address = OrderShippingAddressOut.model_validate(
            order.shipping_address_snapshot
        )
    elif order.shipping_address_id is not None:
        # 스냅샷 도입(2026-07-11) 전 주문 폴백 — 라이브 주소 조인
        address = await session.get(ShippingAddress, order.shipping_address_id)
        if address is not None:
            out.shipping_address = OrderShippingAddressOut.model_validate(address)
    out.customer_actions = customer_actions(
        order.order_type,
        order.status,
        has_blocking_claim=(
            order.id in claim_context.active_order_ids
            or order.id in claim_context.completed_cancel_order_ids
        ),
    )
    return out


@router.post("/orders/{order_id}/confirm-purchase", response_model=OrderOut)
async def confirm_purchase(order_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> OrderOut:
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
