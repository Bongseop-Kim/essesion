import uuid
from datetime import UTC, date, datetime
from typing import Any, Literal

from db.models.auth import User
from db.models.commerce import (
    Claim,
    Inquiry,
    Order,
    OrderItem,
    OrderStatusLog,
    PaymentIncident,
    QuoteRequest,
    RepairPickupRequest,
    RepairShippingReceipt,
)
from db.models.images import Image
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.domains.admin.helpers import (
    KST,
    kst_day_bounds,
    resolve_shipping_address,
)
from api.domains.admin.schemas import (
    AdminAction,
    AdminActiveClaimOut,
    AdminOrderCustomerOut,
    AdminOrderDetailOut,
    AdminOrderReferenceImageOut,
    AdminOrderStatusLogOut,
    AdminOrderSummaryOut,
    AdminRelatedOrderOut,
    DashboardRecentOrdersPage,
    DashboardRecentQuoteOut,
    DashboardRecentQuotesPage,
    DashboardSummaryOut,
    OrderSort,
    OrderStatusFilter,
    OrderTypeFilter,
    Page,
)
from api.domains.admin.types import SortDirection
from api.domains.orders.schemas import OrderItemOut
from api.domains.orders.status_machine import (
    ACTIVE_CLAIM_STATUSES,
    FORWARD,
    ROLLBACK,
)
from api.domains.orders.status_machine import (
    admin_actions as available_admin_actions,
)
from api.errors import DomainError, NotFoundError

DEFAULT_PAGE_LIMIT = 20
MAX_PAGE_LIMIT = 100
DEFAULT_RECENT_LIMIT = 5
MAX_RECENT_LIMIT = 20
MIN_SEARCH_LENGTH = 2
ORDER_REFERENCE_IMAGE_TYPES = ("custom_order", "sample_order")


def _sanitize_private_item_value(value: Any) -> Any:
    if isinstance(value, dict):
        safe: dict[str, Any] = {}
        for key, child in value.items():
            if key == "reference_images" and isinstance(child, list):
                safe["reference_image_count"] = len(child)
                continue
            if key == "object_key" or key.endswith("_object_key"):
                continue
            if isinstance(child, str) and child.startswith("uploads/"):
                continue
            safe[key] = _sanitize_private_item_value(child)
        return safe
    if isinstance(value, list):
        return [
            _sanitize_private_item_value(child)
            for child in value
            if not (isinstance(child, str) and child.startswith("uploads/"))
        ]
    return value


def safe_order_item_out(item: OrderItem) -> OrderItemOut:
    out = OrderItemOut.model_validate(item)
    out.item_data = (
        _sanitize_private_item_value(item.item_data) if item.item_data is not None else None
    )
    return out


def _dashboard_dates(start_date: date | None, end_date: date | None) -> tuple[date, date]:
    today = datetime.now(KST).date()
    start = start_date or end_date or today
    end = end_date or start_date or today
    kst_day_bounds(start, end)
    return start, end


def _order_filters(
    *,
    order_type: OrderTypeFilter,
    status: OrderStatusFilter,
    start_date: date | None,
    end_date: date | None,
    q: str | None,
) -> list[ColumnElement[bool]]:
    filters: list[ColumnElement[bool]] = []
    if order_type != "all":
        filters.append(Order.order_type == order_type)
    if status != "all":
        filters.append(Order.status == status)
    if start_date is not None or end_date is not None:
        start = start_date or end_date
        end = end_date or start_date
        assert start is not None and end is not None
        start_at, end_at = kst_day_bounds(start, end)
        assert start_at is not None and end_at is not None
        filters.extend((Order.created_at >= start_at, Order.created_at < end_at))
    if q is not None:
        normalized = q.strip()
        if len(normalized) < MIN_SEARCH_LENGTH:
            raise DomainError(
                f"Search query must be at least {MIN_SEARCH_LENGTH} characters",
                code="invalid_search",
            )
        filters.append(Order.order_number.icontains(normalized, autoescape=True))
    return filters


def _sort_clauses(sort: OrderSort, direction: SortDirection) -> tuple[Any, Any]:
    columns = {
        "created_at": Order.created_at,
        "updated_at": Order.updated_at,
        "order_number": Order.order_number,
        "order_amount": Order.total_price,
        "status": Order.status,
    }
    column = columns[sort]
    if direction == "asc":
        return column.asc(), Order.id.asc()
    return column.desc(), Order.id.desc()


async def _active_claim_order_ids(
    session: AsyncSession, order_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    if not order_ids:
        return set()
    rows = await session.scalars(
        select(Claim.order_id).where(
            Claim.order_id.in_(order_ids), Claim.status.in_(ACTIVE_CLAIM_STATUSES)
        )
    )
    return set(rows)


async def _repair_previous_statuses(
    session: AsyncSession, orders: list[Order]
) -> dict[uuid.UUID, str]:
    candidate_ids = [
        order.id for order in orders if order.order_type == "repair" and order.status == "접수"
    ]
    if not candidate_ids:
        return {}
    pickup_ids = set(
        await session.scalars(
            select(RepairPickupRequest.order_id).where(
                RepairPickupRequest.order_id.in_(candidate_ids)
            )
        )
    )
    no_tracking_ids = set(
        await session.scalars(
            select(RepairShippingReceipt.order_id).where(
                RepairShippingReceipt.order_id.in_(candidate_ids),
                RepairShippingReceipt.receipt_type == "no_tracking",
            )
        )
    )
    return {
        order_id: (
            "수거예정"
            if order_id in pickup_ids
            else "발송확인중"
            if order_id in no_tracking_ids
            else "발송중"
        )
        for order_id in candidate_ids
    }


def _status_action(
    *,
    kind: Literal["advance", "rollback", "cancel"],
    target_status: str,
    has_active_claim: bool,
) -> AdminAction:
    labels = {
        "advance": f"{target_status} 상태로 진행",
        "rollback": f"{target_status} 상태로 롤백",
        "cancel": "주문 취소",
    }
    return AdminAction(
        kind=kind,
        target_status=target_status,
        label=labels[kind],
        enabled=not has_active_claim,
        blocking_reason=(
            "활성 클레임이 있어 주문 상태를 변경할 수 없습니다" if has_active_claim else None
        ),
        requires_memo=kind == "rollback",
        destructive=kind in ("rollback", "cancel"),
    )


def _admin_actions(
    order: Order,
    *,
    has_active_claim: bool,
    repair_previous_status: str | None,
) -> list[AdminAction]:
    actions: list[AdminAction] = []
    kinds = available_admin_actions(order.order_type, order.status)
    if "advance" in kinds:
        targets = sorted(
            target for current, target in FORWARD[order.order_type] if current == order.status
        )
        actions.extend(
            _status_action(kind="advance", target_status=target, has_active_claim=has_active_claim)
            for target in targets
        )
    if "rollback" in kinds:
        targets = sorted(
            target for current, target in ROLLBACK[order.order_type] if current == order.status
        )
        if order.order_type == "repair" and order.status == "접수" and repair_previous_status:
            targets.append(repair_previous_status)
        actions.extend(
            _status_action(kind="rollback", target_status=target, has_active_claim=has_active_claim)
            for target in dict.fromkeys(targets)
        )
    if "cancel" in kinds:
        actions.append(
            _status_action(kind="cancel", target_status="취소", has_active_claim=has_active_claim)
        )

    tracking_enabled = order.status not in ("배송완료", "완료", "취소")
    actions.append(
        AdminAction(
            kind="update_tracking",
            label="송장 정보 수정",
            enabled=tracking_enabled,
            blocking_reason=(
                None if tracking_enabled else "현재 주문 상태에서는 송장을 수정할 수 없습니다"
            ),
        )
    )
    return actions


async def _action_context(
    session: AsyncSession, orders: list[Order]
) -> tuple[set[uuid.UUID], dict[uuid.UUID, str]]:
    ids = [order.id for order in orders]
    return (
        await _active_claim_order_ids(session, ids),
        await _repair_previous_statuses(session, orders),
    )


def _summary(
    order: Order,
    customer: User,
    *,
    has_active_claim: bool,
    repair_previous_status: str | None,
) -> AdminOrderSummaryOut:
    return AdminOrderSummaryOut(
        id=order.id,
        order_number=order.order_number,
        order_type=order.order_type,
        status=order.status,
        order_amount=order.total_price,
        payment_group_id=order.payment_group_id,
        created_at=order.created_at,
        updated_at=order.updated_at,
        customer=AdminOrderCustomerOut.model_validate(customer),
        admin_actions=_admin_actions(
            order,
            has_active_claim=has_active_claim,
            repair_previous_status=repair_previous_status,
        ),
    )


async def list_orders(
    session: AsyncSession,
    *,
    order_type: OrderTypeFilter,
    status: OrderStatusFilter,
    start_date: date | None,
    end_date: date | None,
    q: str | None,
    sort: OrderSort,
    direction: SortDirection,
    limit: int,
    offset: int,
) -> Page[AdminOrderSummaryOut]:
    filters = _order_filters(
        order_type=order_type,
        status=status,
        start_date=start_date,
        end_date=end_date,
        q=q,
    )
    total = int(await session.scalar(select(func.count()).select_from(Order).where(*filters)) or 0)
    sort_clause, id_clause = _sort_clauses(sort, direction)
    rows = (
        await session.execute(
            select(Order, User)
            .join(User, User.id == Order.user_id)
            .where(*filters)
            .order_by(sort_clause, id_clause)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    orders = [order for order, _ in rows]
    active_claim_ids, repair_previous = await _action_context(session, orders)
    return Page[AdminOrderSummaryOut](
        items=[
            _summary(
                order,
                customer,
                has_active_claim=order.id in active_claim_ids,
                repair_previous_status=repair_previous.get(order.id),
            )
            for order, customer in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


async def dashboard_summary(
    session: AsyncSession,
    *,
    start_date: date | None,
    end_date: date | None,
    order_type: OrderTypeFilter,
) -> DashboardSummaryOut:
    start, end = _dashboard_dates(start_date, end_date)
    start_at, end_at = kst_day_bounds(start, end)
    assert start_at is not None and end_at is not None
    filters: list[ColumnElement[bool]] = [
        Order.created_at >= start_at,
        Order.created_at < end_at,
    ]
    if order_type != "all":
        filters.append(Order.order_type == order_type)
    order_count, order_amount = (
        await session.execute(
            select(func.count(), func.coalesce(func.sum(Order.total_price), 0)).where(*filters)
        )
    ).one()
    open_claim_count = int(
        await session.scalar(
            select(func.count()).select_from(Claim).where(Claim.status.in_(ACTIVE_CLAIM_STATUSES))
        )
        or 0
    )
    unanswered_inquiry_count = int(
        await session.scalar(
            select(func.count()).select_from(Inquiry).where(Inquiry.status == "답변대기")
        )
        or 0
    )
    open_payment_incident_count = int(
        await session.scalar(
            select(func.count())
            .select_from(PaymentIncident)
            .where(PaymentIncident.status == "open")
        )
        or 0
    )
    return DashboardSummaryOut(
        start_date=start,
        end_date=end,
        order_type=order_type,
        order_count=int(order_count),
        order_amount=int(order_amount),
        open_claim_count=open_claim_count,
        unanswered_inquiry_count=unanswered_inquiry_count,
        open_payment_incident_count=open_payment_incident_count,
        as_of=datetime.now(UTC),
    )


async def recent_orders(
    session: AsyncSession, *, order_type: OrderTypeFilter, limit: int
) -> DashboardRecentOrdersPage:
    page = await list_orders(
        session,
        order_type=order_type,
        status="all",
        start_date=None,
        end_date=None,
        q=None,
        sort="created_at",
        direction="desc",
        limit=limit,
        offset=0,
    )
    return DashboardRecentOrdersPage(**page.model_dump(), as_of=datetime.now(UTC))


async def recent_quotes(session: AsyncSession, *, limit: int) -> DashboardRecentQuotesPage:
    total = int(await session.scalar(select(func.count()).select_from(QuoteRequest)) or 0)
    rows = (
        await session.execute(
            select(QuoteRequest, User)
            .join(User, User.id == QuoteRequest.user_id)
            .order_by(QuoteRequest.created_at.desc(), QuoteRequest.id.desc())
            .limit(limit)
        )
    ).all()
    return DashboardRecentQuotesPage(
        items=[
            DashboardRecentQuoteOut(
                id=quote.id,
                quote_number=quote.quote_number,
                status=quote.status,
                quoted_amount=quote.quoted_amount,
                customer=AdminOrderCustomerOut.model_validate(customer),
                business_name=quote.business_name,
                created_at=quote.created_at,
            )
            for quote, customer in rows
        ],
        total=total,
        limit=limit,
        offset=0,
        as_of=datetime.now(UTC),
    )


async def get_order_detail(session: AsyncSession, order_id: uuid.UUID) -> AdminOrderDetailOut:
    row = (
        await session.execute(
            select(Order, User).join(User, User.id == Order.user_id).where(Order.id == order_id)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Order not found")
    order, customer = row
    items = (
        await session.scalars(
            select(OrderItem)
            .where(OrderItem.order_id == order.id)
            .order_by(OrderItem.created_at.asc(), OrderItem.id.asc())
        )
    ).all()
    status_logs = (
        await session.scalars(
            select(OrderStatusLog)
            .where(OrderStatusLog.order_id == order.id)
            .order_by(OrderStatusLog.created_at.asc(), OrderStatusLog.id.asc())
        )
    ).all()
    active_claim = await session.scalar(
        select(Claim)
        .where(Claim.order_id == order.id, Claim.status.in_(ACTIVE_CLAIM_STATUSES))
        .order_by(Claim.created_at.desc(), Claim.id.desc())
        .limit(1)
    )
    related_orders: list[Order] = []
    if order.payment_group_id is not None:
        related_orders = list(
            await session.scalars(
                select(Order)
                .where(
                    Order.payment_group_id == order.payment_group_id,
                    Order.id != order.id,
                )
                .order_by(Order.created_at.asc(), Order.id.asc())
            )
        )
    active_claim_ids, repair_previous = await _action_context(session, [order])
    summary = _summary(
        order,
        customer,
        has_active_claim=order.id in active_claim_ids,
        repair_previous_status=repair_previous.get(order.id),
    )
    return AdminOrderDetailOut(
        **summary.model_dump(),
        original_price=order.original_price,
        total_discount=order.total_discount,
        shipping_cost=order.shipping_cost,
        shipping_address_id=order.shipping_address_id,
        shipping_address=await resolve_shipping_address(
            session, order.shipping_address_snapshot, order.shipping_address_id
        ),
        courier_company=order.courier_company,
        tracking_number=order.tracking_number,
        shipped_at=order.shipped_at,
        delivered_at=order.delivered_at,
        confirmed_at=order.confirmed_at,
        company_courier_company=order.company_courier_company,
        company_tracking_number=order.company_tracking_number,
        company_shipped_at=order.company_shipped_at,
        items=[safe_order_item_out(item) for item in items],
        status_logs=[AdminOrderStatusLogOut.model_validate(log) for log in status_logs],
        active_claim=(
            AdminActiveClaimOut.model_validate(active_claim) if active_claim is not None else None
        ),
        related_orders=[
            AdminRelatedOrderOut(
                id=related.id,
                order_number=related.order_number,
                order_type=related.order_type,
                status=related.status,
                order_amount=related.total_price,
                created_at=related.created_at,
            )
            for related in related_orders
        ],
    )


async def list_order_reference_images(
    session: AsyncSession, order_id: uuid.UUID
) -> list[AdminOrderReferenceImageOut]:
    if await session.get(Order, order_id) is None:
        raise NotFoundError("Order not found")
    images = list(
        await session.scalars(
            select(Image)
            .where(
                Image.entity_type.in_(ORDER_REFERENCE_IMAGE_TYPES),
                Image.entity_id == str(order_id),
                Image.upload_completed_at.is_not(None),
                Image.deleted_at.is_(None),
            )
            .order_by(Image.created_at.asc(), Image.id.asc())
        )
    )
    return [
        AdminOrderReferenceImageOut(
            id=image.id,
            content_type=image.content_type,
            size_bytes=image.size_bytes,
            created_at=image.created_at,
        )
        for image in images
    ]


async def get_order_reference_image(
    session: AsyncSession, order_id: uuid.UUID, image_id: uuid.UUID
) -> Image:
    image = await session.scalar(
        select(Image).where(
            Image.id == image_id,
            Image.entity_type.in_(ORDER_REFERENCE_IMAGE_TYPES),
            Image.entity_id == str(order_id),
            Image.upload_completed_at.is_not(None),
            Image.deleted_at.is_(None),
        )
    )
    if image is None or (image.expires_at is not None and image.expires_at <= datetime.now(UTC)):
        raise NotFoundError("주문 참고 이미지를 찾을 수 없습니다")
    return image
