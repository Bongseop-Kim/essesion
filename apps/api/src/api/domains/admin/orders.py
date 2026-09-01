import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from db.models.auth import User
from db.models.commerce import (
    Claim,
    Inquiry,
    ManualOrder,
    Order,
    OrderItem,
    OrderStatusLog,
    PaymentIncident,
    Product,
    QuoteRequest,
)
from db.models.design import GenerationJob
from db.models.tokens import DesignToken, TokenPurchase
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

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
    DashboardOrderTypeFilter,
    DashboardRecentOrdersPage,
    DashboardRecentQuoteOut,
    DashboardRecentQuotesPage,
    DashboardSummaryOut,
    DashboardTimeseriesOut,
    DashboardTimeseriesPointOut,
    DashboardTopProductOut,
    DashboardTopProductsOut,
    OrderSort,
    OrderStatusFilter,
    OrderTypeFilter,
    Page,
    SortDirection,
)
from api.domains.images.service import (
    ADMIN_ORDER_IMAGE_TYPES,
    get_linked_order_image,
    list_linked_order_images,
)
from api.domains.orders import service as order_service
from api.domains.orders.schemas import ClaimBadgeOut, OrderItemOut
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
MAX_TIMESERIES_DAYS = 92
DEFAULT_TOP_PRODUCT_LIMIT = 5
MAX_TOP_PRODUCT_LIMIT = 20

# 매출 지표는 Order.paid_at 하나로 정의한다 — 윈도우 조건이 미결제(NULL)를 자동 배제하므로
# 상태 기반 제외 목록이 없다. 결제 후 취소는 차감하지 않고 클레임 지표에서 본다.


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


def safe_order_item_out(item: OrderItem, claim: Claim | None = None) -> OrderItemOut:
    out = OrderItemOut.model_validate(item)
    out.item_data = _sanitize_private_item_value(item.item_data)
    if claim is not None:
        out.claim = ClaimBadgeOut.model_validate(claim)
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
    start_at, end_at = kst_day_bounds(start_date, end_date)
    if start_at is not None:
        filters.append(Order.created_at >= start_at)
    if end_at is not None:
        filters.append(Order.created_at < end_at)
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


async def _repair_previous_statuses(
    session: AsyncSession, orders: list[Order]
) -> dict[uuid.UUID, str]:
    candidate_ids = [
        order.id for order in orders if order.order_type == "repair" and order.status == "접수"
    ]
    if not candidate_ids:
        return {}
    return await order_service.repair_previous_statuses(session, candidate_ids)


def _status_action(
    *,
    kind: Literal["advance", "rollback", "cancel"],
    target_status: str,
    blocking_reason: str | None,
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
        enabled=blocking_reason is None,
        blocking_reason=blocking_reason,
        requires_memo=kind == "rollback",
        destructive=kind in ("rollback", "cancel"),
    )


def _admin_actions(
    order: Order,
    *,
    has_active_claim: bool,
    has_completed_cancel_claim: bool,
    repair_previous_status: str | None,
) -> list[AdminAction]:
    actions: list[AdminAction] = []
    status_blocking_reason = (
        "취소 클레임이 완료되어 주문 상태를 변경할 수 없습니다"
        if has_completed_cancel_claim
        else "활성 클레임이 있어 주문 상태를 변경할 수 없습니다"
        if has_active_claim
        else None
    )
    kinds = available_admin_actions(order.order_type, order.status)
    if "advance" in kinds:
        targets = sorted(
            target for current, target in FORWARD[order.order_type] if current == order.status
        )
        actions.extend(
            _status_action(
                kind="advance", target_status=target, blocking_reason=status_blocking_reason
            )
            for target in targets
        )
    if "rollback" in kinds:
        targets = sorted(
            target for current, target in ROLLBACK[order.order_type] if current == order.status
        )
        if order.order_type == "repair" and order.status == "접수" and repair_previous_status:
            targets.append(repair_previous_status)
        actions.extend(
            _status_action(
                kind="rollback", target_status=target, blocking_reason=status_blocking_reason
            )
            for target in dict.fromkeys(targets)
        )
    if "cancel" in kinds:
        actions.append(
            _status_action(
                kind="cancel", target_status="취소", blocking_reason=status_blocking_reason
            )
        )

    tracking_blocking_reason = (
        "취소 클레임이 완료되어 송장을 수정할 수 없습니다"
        if has_completed_cancel_claim
        else "활성 클레임이 있어 송장을 수정할 수 없습니다"
        if has_active_claim
        else "현재 주문 상태에서는 송장을 수정할 수 없습니다"
        if order.status in ("배송완료", "완료", "취소")
        else None
    )
    actions.append(
        AdminAction(
            kind="update_tracking",
            label="송장 정보 수정",
            enabled=tracking_blocking_reason is None,
            blocking_reason=tracking_blocking_reason,
        )
    )
    return actions


def _summary(
    order: Order,
    customer: User,
    *,
    has_active_claim: bool,
    has_completed_cancel_claim: bool,
    repair_previous_status: str | None,
    claim: Claim | None,
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
        claim_summary=ClaimBadgeOut.model_validate(claim) if claim is not None else None,
        admin_actions=_admin_actions(
            order,
            has_active_claim=has_active_claim,
            has_completed_cancel_claim=has_completed_cancel_claim,
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
    order_ids = [order.id for order in orders]
    claims = (
        (await session.scalars(select(Claim).where(Claim.order_id.in_(order_ids)))).all()
        if order_ids
        else []
    )
    claim_context = order_service.claim_read_model(claims)
    repair_previous = await _repair_previous_statuses(session, orders)
    return Page[AdminOrderSummaryOut](
        items=[
            _summary(
                order,
                customer,
                has_active_claim=order.id in claim_context.active_order_ids,
                has_completed_cancel_claim=(order.id in claim_context.completed_cancel_order_ids),
                repair_previous_status=repair_previous.get(order.id),
                claim=claim_context.by_order.get(order.id),
            )
            for order, customer in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


def _manual_order_filters(start: date, end: date) -> list[ColumnElement[bool]]:
    """수기 주문의 매출 인정 조건 — 결제 완료분만, order_date를 매출일로 본다.

    manual_orders에는 Order.paid_at에 대응하는 결제 시각이 없다(종이 작업지시서의 장부라
    order_date(date)와 is_paid(bool)뿐). 그래서 이 두 값이 매출일·매출 인정의 유일한 기준이다.
    """
    return [
        ManualOrder.is_paid.is_(True),
        ManualOrder.order_date >= start,
        ManualOrder.order_date <= end,
    ]


# 수기 주문 매출 = 원금 − 할인 + 택배비(실수령액). Order.total_price가 배송비를 포함하므로
# 같은 기준이다.
_MANUAL_ORDER_AMOUNT = ManualOrder.amount - ManualOrder.discount + ManualOrder.shipping_fee

# 시계열 스택 막대의 구획. Order.order_type의 전체 값이며, 합은 order_amount와 같아야 한다.
_ORDER_AMOUNT_TYPES = ("sale", "custom", "repair", "sample", "token")

# 수기 주문의 유형 분해 — 품목 중 하나라도 주문제작 스펙이 있으면 주문제작 수기로 센다.
# 수기 주문은 금액이 주문 단위(품목별 금액이 없다)라 품목 배분 근거가 없다. JSONB 포함
# 연산자(`@>`)는 빈 객체가 모든 객체에 포함되는 성질을 쓴다 — custom이 null이면 매치되지 않는다.
_MANUAL_HAS_CUSTOM = ManualOrder.items.contains([{"custom": {}}])


async def dashboard_summary(
    session: AsyncSession,
    *,
    start_date: date | None,
    end_date: date | None,
    order_type: DashboardOrderTypeFilter,
) -> DashboardSummaryOut:
    start, end = _dashboard_dates(start_date, end_date)
    start_at, end_at = kst_day_bounds(start, end)
    assert start_at is not None and end_at is not None
    order_count, order_amount = 0, 0
    # order_type="manual"은 수기 주문만 본다 — Order 쪽은 건너뛴다.
    if order_type != "manual":
        filters: list[ColumnElement[bool]] = [
            Order.paid_at >= start_at,
            Order.paid_at < end_at,
        ]
        if order_type != "all":
            filters.append(Order.order_type == order_type)
        order_count, order_amount = (
            await session.execute(
                select(func.count(), func.coalesce(func.sum(Order.total_price), 0)).where(*filters)
            )
        ).one()
    if order_type in ("all", "manual"):
        manual_count, manual_amount = (
            await session.execute(
                select(func.count(), func.coalesce(func.sum(_MANUAL_ORDER_AMOUNT), 0)).where(
                    *_manual_order_filters(start, end)
                )
            )
        ).one()
        order_count += int(manual_count)
        order_amount += int(manual_amount)
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


def _kst_day(column: InstrumentedAttribute[datetime | None]) -> ColumnElement[date]:
    """timestamptz 컬럼을 KST 기준 날짜로 버킷팅한다."""
    return func.date(func.timezone("Asia/Seoul", column))


async def dashboard_timeseries(
    session: AsyncSession,
    *,
    start_date: date | None,
    end_date: date | None,
    order_type: DashboardOrderTypeFilter,
) -> DashboardTimeseriesOut:
    """지표 5종의 KST 일별 시계열. order_type 필터는 주문 시리즈에만 적용된다."""
    start, end = _dashboard_dates(start_date, end_date)
    if (end - start).days + 1 > MAX_TIMESERIES_DAYS:
        raise DomainError(
            f"Date range must be at most {MAX_TIMESERIES_DAYS} days",
            code="invalid_range",
        )
    start_at, end_at = kst_day_bounds(start, end)
    assert start_at is not None and end_at is not None

    async def by_day(
        column: InstrumentedAttribute[datetime | None],
        *exprs: ColumnElement[Any],
        filters: list[Any],
    ) -> dict[date, tuple[Any, ...]]:
        day = _kst_day(column)
        rows = await session.execute(
            select(day, *exprs).where(column >= start_at, column < end_at, *filters).group_by(day)
        )
        return {row[0]: tuple(row[1:]) for row in rows.all()}

    orders: dict[date, tuple[Any, ...]] = {}
    if order_type != "manual":
        order_filters: list[Any] = []
        if order_type != "all":
            order_filters.append(Order.order_type == order_type)
        orders = await by_day(
            Order.paid_at,
            func.count(),
            func.coalesce(func.sum(Order.total_price), 0),
            *(
                func.coalesce(func.sum(Order.total_price).filter(Order.order_type == name), 0)
                for name in _ORDER_AMOUNT_TYPES
            ),
            filters=order_filters,
        )
    # 수기 주문은 order_date가 이미 KST date라 타임존 변환 없이 그대로 버킷이다.
    manual: dict[date, tuple[int, int, int]] = {}
    if order_type in ("all", "manual"):
        rows = await session.execute(
            select(
                ManualOrder.order_date,
                func.count(),
                func.coalesce(func.sum(_MANUAL_ORDER_AMOUNT), 0),
                func.coalesce(func.sum(_MANUAL_ORDER_AMOUNT).filter(_MANUAL_HAS_CUSTOM), 0),
            )
            .where(*_manual_order_filters(start, end))
            .group_by(ManualOrder.order_date)
        )
        manual = {row[0]: (int(row[1]), int(row[2]), int(row[3])) for row in rows.all()}
    customers = await by_day(User.created_at, func.count(), filters=[User.role == "customer"])
    generations = await by_day(
        GenerationJob.created_at,
        func.count(),
        func.count().filter(GenerationJob.status == "failed"),
        filters=[],
    )
    consumed = await by_day(
        DesignToken.created_at,
        func.coalesce(func.sum(-DesignToken.amount), 0),
        filters=[DesignToken.amount < 0],
    )
    sold = await by_day(
        TokenPurchase.created_at,
        func.coalesce(func.sum(TokenPurchase.token_amount), 0),
        filters=[TokenPurchase.status == "완료"],
    )

    points: list[DashboardTimeseriesPointOut] = []
    empty_orders = (0, 0, *(0 for _ in _ORDER_AMOUNT_TYPES))
    day = start
    while day <= end:
        order_count, order_amount, *type_amounts = orders.get(day, empty_orders)
        by_type = dict(
            zip(_ORDER_AMOUNT_TYPES, (int(value) for value in type_amounts), strict=True)
        )
        manual_count, manual_amount, manual_custom_amount = manual.get(day, (0, 0, 0))
        order_count = int(order_count) + manual_count
        order_amount = int(order_amount) + manual_amount
        generation_total, generation_failed = generations.get(day, (0, 0))
        points.append(
            DashboardTimeseriesPointOut(
                day=day,
                order_count=int(order_count),
                order_amount=int(order_amount),
                sale_amount=by_type["sale"],
                custom_amount=by_type["custom"],
                repair_amount=by_type["repair"],
                sample_amount=by_type["sample"],
                token_amount=by_type["token"],
                manual_custom_amount=manual_custom_amount,
                manual_repair_amount=manual_amount - manual_custom_amount,
                new_customer_count=int(customers.get(day, (0,))[0]),
                generation_total=int(generation_total),
                generation_failed=int(generation_failed),
                token_consumed=int(consumed.get(day, (0,))[0]),
                token_sold=int(sold.get(day, (0,))[0]),
            )
        )
        day += timedelta(days=1)
    return DashboardTimeseriesOut(
        start_date=start,
        end_date=end,
        order_type=order_type,
        points=points,
        as_of=datetime.now(UTC),
    )


async def dashboard_top_products(
    session: AsyncSession,
    *,
    start_date: date | None,
    end_date: date | None,
    limit: int,
) -> DashboardTopProductsOut:
    """기간 내 주문 수량 기준 상품 랭킹 — product_id 없는 항목(custom/reform)은 제외."""
    start, end = _dashboard_dates(start_date, end_date)
    if (end - start).days + 1 > MAX_TIMESERIES_DAYS:
        raise DomainError(
            f"Date range must be at most {MAX_TIMESERIES_DAYS} days",
            code="invalid_range",
        )
    start_at, end_at = kst_day_bounds(start, end)
    assert start_at is not None and end_at is not None
    quantity = func.sum(OrderItem.quantity)
    amount = func.sum(OrderItem.unit_price * OrderItem.quantity)
    rows = (
        await session.execute(
            select(OrderItem.product_id, Product.name, quantity, amount)
            .join(Order, Order.id == OrderItem.order_id)
            .join(Product, Product.id == OrderItem.product_id)
            .where(Order.paid_at >= start_at, Order.paid_at < end_at)
            .group_by(OrderItem.product_id, Product.name)
            .order_by(quantity.desc(), OrderItem.product_id.asc())
            .limit(limit)
        )
    ).all()
    return DashboardTopProductsOut(
        items=[
            DashboardTopProductOut(
                product_id=product_id,
                name=name,
                quantity=int(item_quantity),
                amount=int(item_amount),
            )
            for product_id, name, item_quantity, item_amount in rows
        ],
        start_date=start,
        end_date=end,
        as_of=datetime.now(UTC),
    )


async def recent_orders(
    session: AsyncSession, *, order_type: DashboardOrderTypeFilter, limit: int
) -> DashboardRecentOrdersPage:
    # "manual"은 Order가 아닌 별도 장부다 — 이 표는 비우고, 수기 주문은 대시보드가
    # /admin/manual-orders를 따로 조회해 자기 표에 그린다.
    if order_type == "manual":
        return DashboardRecentOrdersPage(
            items=[], total=0, limit=limit, offset=0, as_of=datetime.now(UTC)
        )
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
    claims = (await session.scalars(select(Claim).where(Claim.order_id == order.id))).all()
    claim_context = order_service.claim_read_model(claims)
    selected_claim = claim_context.by_order.get(order.id)
    active_claim = (
        selected_claim
        if selected_claim is not None and selected_claim.status in ACTIVE_CLAIM_STATUSES
        else None
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
    repair_previous = await _repair_previous_statuses(session, [order])
    repair_receipts = (
        await order_service.repair_receipts_read_model(session, order.id)
        if order.order_type == "repair"
        else []
    )
    summary = _summary(
        order,
        customer,
        has_active_claim=order.id in claim_context.active_order_ids,
        has_completed_cancel_claim=order.id in claim_context.completed_cancel_order_ids,
        repair_previous_status=repair_previous.get(order.id),
        claim=selected_claim,
    )
    return AdminOrderDetailOut(
        **summary.model_dump(),
        original_price=order.original_price,
        total_discount=order.total_discount,
        shipping_cost=order.shipping_cost,
        shipping_address_id=order.shipping_address_id,
        shipping_address=resolve_shipping_address(order.shipping_address_snapshot),
        courier_company=order.courier_company,
        tracking_number=order.tracking_number,
        shipped_at=order.shipped_at,
        delivered_at=order.delivered_at,
        confirmed_at=order.confirmed_at,
        company_courier_company=order.company_courier_company,
        company_tracking_number=order.company_tracking_number,
        company_shipped_at=order.company_shipped_at,
        items=[safe_order_item_out(item, claim_context.by_item.get(item.id)) for item in items],
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
        repair_receipts=repair_receipts,
    )


def _image_owner_index(
    items: list[OrderItem],
) -> tuple[dict[str, uuid.UUID], dict[str, uuid.UUID]]:
    """(image_id → 품목, object_key → 품목).

    이미지 행은 주문 단위로 링크되지만(entity_id = order_id) 품목별로 올린 사진이다.
    맞춤·샘플은 item_data.reference_images에 image_id를, 수선은 tie.image.object_key를 남긴다.
    """
    by_id: dict[str, uuid.UUID] = {}
    by_key: dict[str, uuid.UUID] = {}
    for item in items:
        data = item.item_data or {}
        for ref in data.get("reference_images") or []:
            image_id = ref.get("image_id") if isinstance(ref, dict) else None
            if image_id:
                by_id[str(image_id)] = item.id
        image = (data.get("tie") or {}).get("image") or {}
        object_key = image.get("object_key")
        if object_key:
            by_key[object_key] = item.id
    return by_id, by_key


async def list_order_reference_images(
    session: AsyncSession, order_id: uuid.UUID
) -> list[AdminOrderReferenceImageOut]:
    if await session.get(Order, order_id) is None:
        raise NotFoundError("Order not found")
    images = await list_linked_order_images(session, order_id, ADMIN_ORDER_IMAGE_TYPES)
    items = list(await session.scalars(select(OrderItem).where(OrderItem.order_id == order_id)))
    by_id, by_key = _image_owner_index(items)
    return [
        AdminOrderReferenceImageOut(
            id=image.id,
            order_item_id=by_id.get(str(image.id)) or by_key.get(image.object_key),
            content_type=image.content_type,
            size_bytes=image.size_bytes,
            created_at=image.created_at,
        )
        for image in images
    ]


async def get_order_reference_image(
    session: AsyncSession, order_id: uuid.UUID, image_id: uuid.UUID
):
    return await get_linked_order_image(session, order_id, image_id, ADMIN_ORDER_IMAGE_TYPES)
