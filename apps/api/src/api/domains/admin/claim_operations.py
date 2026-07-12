import uuid
from datetime import date, datetime, time, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from db.models.auth import User
from db.models.commerce import (
    AdminOperationLog,
    Claim,
    ClaimNotificationLog,
    ClaimStatusLog,
    Order,
    OrderItem,
    OrderStatusLog,
    PaymentIncident,
    RepairPickupRequest,
    RepairShippingReceipt,
    ShippingAddress,
)
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.domains.admin.operations import idempotent_result, record_operation
from api.domains.admin.orders import safe_order_item_out
from api.domains.admin.phase_d_schemas import (
    AdminClaimAction,
    AdminClaimCustomerOut,
    AdminClaimDetailOut,
    AdminClaimOrderOut,
    AdminClaimShippingOut,
    AdminClaimStatusLogOut,
    AdminClaimSummaryOut,
    AdminClaimTrackingAction,
    AdminTimelineEvent,
    ClaimNotificationOut,
    ClaimSort,
    ClaimStatusFilter,
    ClaimTrackingUpdateRequest,
    ClaimTypeFilter,
    PaymentIncidentSummaryOut,
    RepairPickupOut,
    RepairShippingReceiptOut,
    SortDirection,
)
from api.domains.admin.schemas import Page
from api.domains.claims.service import FORWARD_CLAIM, REJECTABLE_FROM, ROLLBACK_CLAIM
from api.domains.orders.schemas import OrderShippingAddressOut
from api.errors import DomainError, NotFoundError

KST = ZoneInfo("Asia/Seoul")
DEFAULT_PAGE_LIMIT = 20
MAX_PAGE_LIMIT = 100
MIN_SEARCH_LENGTH = 2


def _kst_range(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    if start_date > end_date:
        raise DomainError("start_date must be before end_date", code="invalid_range")
    return (
        datetime.combine(start_date, time.min, tzinfo=KST),
        datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=KST),
    )


def _filters(
    *,
    claim_type: ClaimTypeFilter,
    status: ClaimStatusFilter,
    start_date: date | None,
    end_date: date | None,
    q: str | None,
) -> list[ColumnElement[bool]]:
    filters: list[ColumnElement[bool]] = []
    if claim_type != "all":
        filters.append(Claim.type == claim_type)
    if status != "all":
        filters.append(Claim.status == status)
    if start_date is not None or end_date is not None:
        start = start_date or end_date
        end = end_date or start_date
        assert start is not None and end is not None
        start_at, end_at = _kst_range(start, end)
        filters.extend((Claim.created_at >= start_at, Claim.created_at < end_at))
    if q is not None:
        normalized = q.strip()
        if len(normalized) < MIN_SEARCH_LENGTH:
            raise DomainError(
                f"Search query must be at least {MIN_SEARCH_LENGTH} characters",
                code="invalid_search",
            )
        filters.append(Claim.claim_number.icontains(normalized, autoescape=True))
    return filters


def _sort_clauses(sort: ClaimSort, direction: SortDirection) -> tuple[Any, Any]:
    columns = {
        "created_at": Claim.created_at,
        "updated_at": Claim.updated_at,
        "claim_number": Claim.claim_number,
        "status": Claim.status,
    }
    column = columns[sort]
    if direction == "asc":
        return column.asc(), Claim.id.asc()
    return column.desc(), Claim.id.desc()


def _action(kind: Literal["advance", "reject", "rollback"], target: str) -> AdminClaimAction:
    if kind == "advance":
        return AdminClaimAction(
            kind=kind,
            target_status=target,
            label=f"{target} 상태로 진행",
            enabled=True,
        )
    if kind == "reject":
        return AdminClaimAction(
            kind=kind,
            target_status=target,
            label="클레임 거부",
            enabled=True,
            requires_memo=True,
            destructive=True,
        )
    return AdminClaimAction(
        kind=kind,
        target_status=target,
        label=f"{target} 상태로 롤백",
        enabled=True,
        requires_memo=True,
        destructive=True,
    )


def admin_actions(claim: Claim, *, actor_role: str) -> list[AdminClaimAction]:
    actions = [
        _action("advance", target)
        for current, target in sorted(FORWARD_CLAIM[claim.type])
        if current == claim.status
    ]
    if claim.status in REJECTABLE_FROM[claim.type]:
        actions.append(_action("reject", "거부"))
    actions.extend(
        _action("rollback", target)
        for current, target in sorted(ROLLBACK_CLAIM[claim.type])
        if current == claim.status
    )
    if claim.type == "token_refund" and claim.status == "접수":
        is_admin = actor_role == "admin"
        actions.insert(
            0,
            AdminClaimAction(
                kind="approve_refund",
                target_status="완료",
                label="토큰 환불 승인",
                enabled=is_admin,
                blocking_reason=None if is_admin else "최고 관리자 권한이 필요합니다",
                destructive=True,
            ),
        )
    return actions


def tracking_actions(claim: Claim) -> list[AdminClaimTrackingAction]:
    actions: list[AdminClaimTrackingAction] = []
    if claim.type in ("return", "exchange"):
        enabled = claim.status != "거부"
        actions.append(
            AdminClaimTrackingAction(
                kind="return",
                label="반송 송장 수정",
                enabled=enabled,
                blocking_reason=None if enabled else "거부된 클레임은 수정할 수 없습니다",
            )
        )
    if claim.type == "exchange":
        enabled = claim.status in ("재발송", "완료")
        actions.append(
            AdminClaimTrackingAction(
                kind="resend",
                label="재발송 송장 수정",
                enabled=enabled,
                blocking_reason=(None if enabled else "재발송 단계 이후에 입력할 수 있습니다"),
            )
        )
    return actions


async def update_claim_tracking(
    session: AsyncSession,
    claim_id: uuid.UUID,
    body: ClaimTrackingUpdateRequest,
    *,
    actor_id: uuid.UUID,
    request_id: str,
) -> None:
    payload = body.model_dump(mode="json", exclude={"operation_id"})
    action = f"claim_{body.kind}_tracking_update"
    previous = await idempotent_result(
        session,
        operation_id=body.operation_id,
        action=action,
        target_type="claim",
        target_id=str(claim_id),
        payload=payload,
    )
    if previous is not None:
        return

    claim = await session.scalar(select(Claim).where(Claim.id == claim_id).with_for_update())
    if claim is None:
        raise NotFoundError("Claim not found")
    if body.kind == "return":
        if claim.type not in ("return", "exchange"):
            raise DomainError(
                "반송 송장은 반품·교환 클레임에만 입력할 수 있습니다",
                code="invalid_tracking_kind",
            )
        if claim.status == "거부":
            raise DomainError(
                "거부된 클레임은 송장을 수정할 수 없습니다",
                code="invalid_tracking_status",
            )
        courier_field = "return_courier_company"
        tracking_field = "return_tracking_number"
    else:
        if claim.type != "exchange":
            raise DomainError(
                "재발송 송장은 교환 클레임에만 입력할 수 있습니다",
                code="invalid_tracking_kind",
            )
        if claim.status not in ("재발송", "완료"):
            raise DomainError(
                "재발송 단계 이후에 송장을 입력할 수 있습니다",
                code="invalid_tracking_status",
            )
        courier_field = "resend_courier_company"
        tracking_field = "resend_tracking_number"

    before = {
        "kind": body.kind,
        "courier_company": getattr(claim, courier_field),
        "tracking_number": getattr(claim, tracking_field),
    }
    after = {
        "kind": body.kind,
        "courier_company": body.courier_company,
        "tracking_number": body.tracking_number,
    }
    if before == after:
        raise DomainError("동일한 송장 정보입니다", code="same_tracking")
    setattr(claim, courier_field, body.courier_company)
    setattr(claim, tracking_field, body.tracking_number)
    record_operation(
        session,
        operation_id=body.operation_id,
        actor_id=actor_id,
        action=action,
        target_type="claim",
        target_id=str(claim.id),
        target_count=1,
        reason=body.memo,
        payload=payload,
        before=before,
        after=after,
        request_id=request_id,
    )
    await session.commit()


def _summary(
    claim: Claim,
    order: Order,
    customer: User,
    *,
    actor_role: str,
) -> AdminClaimSummaryOut:
    return AdminClaimSummaryOut(
        id=claim.id,
        claim_number=claim.claim_number,
        type=claim.type,
        status=claim.status,
        reason=claim.reason,
        quantity=claim.quantity,
        order_id=order.id,
        order_number=order.order_number,
        customer=AdminClaimCustomerOut.model_validate(customer),
        created_at=claim.created_at,
        updated_at=claim.updated_at,
        admin_actions=admin_actions(claim, actor_role=actor_role),
    )


async def list_claims(
    session: AsyncSession,
    *,
    actor_role: str,
    claim_type: ClaimTypeFilter,
    status: ClaimStatusFilter,
    start_date: date | None,
    end_date: date | None,
    q: str | None,
    sort: ClaimSort,
    direction: SortDirection,
    limit: int,
    offset: int,
) -> Page[AdminClaimSummaryOut]:
    filters = _filters(
        claim_type=claim_type,
        status=status,
        start_date=start_date,
        end_date=end_date,
        q=q,
    )
    total = int(await session.scalar(select(func.count()).select_from(Claim).where(*filters)) or 0)
    primary_sort, id_sort = _sort_clauses(sort, direction)
    rows = (
        await session.execute(
            select(Claim, Order, User)
            .join(Order, Order.id == Claim.order_id)
            .join(User, User.id == Claim.user_id)
            .where(*filters)
            .order_by(primary_sort, id_sort)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Page[AdminClaimSummaryOut](
        items=[_summary(claim, order, user, actor_role=actor_role) for claim, order, user in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


async def _shipping_address(session: AsyncSession, order: Order) -> OrderShippingAddressOut | None:
    if order.shipping_address_snapshot:
        return OrderShippingAddressOut.model_validate(order.shipping_address_snapshot)
    if order.shipping_address_id is None:
        return None
    address = await session.get(ShippingAddress, order.shipping_address_id)
    return OrderShippingAddressOut.model_validate(address) if address is not None else None


def _incident_summary(incident: PaymentIncident) -> PaymentIncidentSummaryOut:
    return PaymentIncidentSummaryOut.model_validate(incident, from_attributes=True)


def _timeline(
    claim: Claim,
    claim_logs: list[ClaimStatusLog],
    order_logs: list[OrderStatusLog],
    receipts: list[RepairShippingReceipt],
    notifications: list[ClaimNotificationLog],
    operation_logs: list[AdminOperationLog],
) -> list[AdminTimelineEvent]:
    events = [
        AdminTimelineEvent(
            event_type="claim_created",
            created_at=claim.created_at,
            title="클레임 접수",
            metadata={"status": "접수"},
        )
    ]
    events.extend(
        AdminTimelineEvent(
            event_type="claim_shipping",
            created_at=log.created_at,
            title=(
                "반송 송장 수정"
                if log.action == "claim_return_tracking_update"
                else "재발송 송장 수정"
            ),
            description=log.reason,
            actor_id=log.actor_id,
            metadata={
                **(log.after_data or {}),
                "request_id": log.request_id,
            },
        )
        for log in operation_logs
    )
    events.extend(
        AdminTimelineEvent(
            event_type="claim_status",
            created_at=log.created_at,
            title=f"클레임 {log.previous_status} → {log.new_status}",
            description=log.memo,
            actor_id=log.changed_by,
            metadata={
                "is_rollback": log.is_rollback,
                "request_id": log.request_id,
            },
        )
        for log in claim_logs
    )
    events.extend(
        AdminTimelineEvent(
            event_type="order_status",
            created_at=log.created_at,
            title=f"주문 {log.previous_status} → {log.new_status}",
            description=log.memo,
            actor_id=log.changed_by,
            metadata={
                "is_rollback": log.is_rollback,
                "request_id": log.request_id,
            },
        )
        for log in order_logs
    )
    events.extend(
        AdminTimelineEvent(
            event_type="repair_shipping",
            created_at=receipt.created_at,
            title="수선 상품 발송 접수",
            description=receipt.memo,
            metadata={
                "receipt_type": receipt.receipt_type,
                "reason": receipt.reason,
                "photo_count": len(receipt.photos or []),
            },
        )
        for receipt in receipts
    )
    events.extend(
        AdminTimelineEvent(
            event_type="notification",
            created_at=notification.updated_at,
            title=f"알림 {notification.delivery_status}",
            description=notification.last_error,
            metadata={
                "claim_status": notification.status,
                "attempts": notification.attempts,
            },
        )
        for notification in notifications
    )
    return sorted(events, key=lambda event: (event.created_at, event.event_type))


async def get_claim_detail(
    session: AsyncSession, claim_id: uuid.UUID, *, actor_role: str
) -> AdminClaimDetailOut:
    row = (
        await session.execute(
            select(Claim, Order, OrderItem, User)
            .join(Order, Order.id == Claim.order_id)
            .join(OrderItem, OrderItem.id == Claim.order_item_id)
            .join(User, User.id == Claim.user_id)
            .where(Claim.id == claim_id)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Claim not found")
    claim, order, item, customer = row
    claim_logs = list(
        await session.scalars(
            select(ClaimStatusLog)
            .where(ClaimStatusLog.claim_id == claim.id)
            .order_by(ClaimStatusLog.created_at.asc(), ClaimStatusLog.id.asc())
        )
    )
    order_logs = list(
        await session.scalars(
            select(OrderStatusLog)
            .where(OrderStatusLog.order_id == order.id)
            .order_by(OrderStatusLog.created_at.asc(), OrderStatusLog.id.asc())
        )
    )
    notifications = list(
        await session.scalars(
            select(ClaimNotificationLog)
            .where(ClaimNotificationLog.claim_id == claim.id)
            .order_by(ClaimNotificationLog.created_at.asc(), ClaimNotificationLog.id.asc())
        )
    )
    receipts = list(
        await session.scalars(
            select(RepairShippingReceipt)
            .where(RepairShippingReceipt.order_id == order.id)
            .order_by(RepairShippingReceipt.created_at.asc(), RepairShippingReceipt.id.asc())
        )
    )
    pickup = await session.scalar(
        select(RepairPickupRequest).where(RepairPickupRequest.order_id == order.id)
    )
    incidents = list(
        await session.scalars(
            select(PaymentIncident)
            .where((PaymentIncident.claim_id == claim.id) | (PaymentIncident.order_id == order.id))
            .order_by(PaymentIncident.created_at.desc(), PaymentIncident.id.desc())
        )
    )
    operation_logs = list(
        await session.scalars(
            select(AdminOperationLog)
            .where(
                AdminOperationLog.target_type == "claim",
                AdminOperationLog.target_id == str(claim.id),
                AdminOperationLog.action.in_(
                    ("claim_return_tracking_update", "claim_resend_tracking_update")
                ),
            )
            .order_by(AdminOperationLog.created_at.asc(), AdminOperationLog.id.asc())
        )
    )
    summary = _summary(claim, order, customer, actor_role=actor_role)
    return AdminClaimDetailOut(
        **summary.model_dump(),
        description=claim.description,
        refund_data=claim.refund_data,
        order=AdminClaimOrderOut(
            id=order.id,
            order_number=order.order_number,
            order_type=order.order_type,
            status=order.status,
            order_amount=order.total_price,
            payment_group_id=order.payment_group_id,
        ),
        item=safe_order_item_out(item),
        shipping=AdminClaimShippingOut(
            shipping_address=await _shipping_address(session, order),
            order_courier_company=order.courier_company,
            order_tracking_number=order.tracking_number,
            company_courier_company=order.company_courier_company,
            company_tracking_number=order.company_tracking_number,
            return_courier_company=claim.return_courier_company,
            return_tracking_number=claim.return_tracking_number,
            resend_courier_company=claim.resend_courier_company,
            resend_tracking_number=claim.resend_tracking_number,
            repair_pickup=RepairPickupOut.model_validate(pickup) if pickup else None,
            repair_receipts=[
                RepairShippingReceiptOut(
                    id=receipt.id,
                    receipt_type=receipt.receipt_type,
                    reason=receipt.reason,
                    memo=receipt.memo,
                    photo_count=len(receipt.photos or []),
                    created_at=receipt.created_at,
                )
                for receipt in receipts
            ],
        ),
        tracking_actions=tracking_actions(claim),
        status_logs=[AdminClaimStatusLogOut.model_validate(log) for log in claim_logs],
        notifications=[ClaimNotificationOut.model_validate(row) for row in notifications],
        payment_incidents=[_incident_summary(incident) for incident in incidents],
        timeline=_timeline(
            claim,
            claim_logs,
            order_logs,
            receipts,
            notifications,
            operation_logs,
        ),
    )
