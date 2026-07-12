import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from db.models.commerce import Claim, Order, PaymentIncident
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.domains.admin.helpers import kst_day_bounds
from api.domains.admin.operations import idempotent_result, record_operation
from api.domains.admin.phase_d_schemas import (
    IncidentAdminAction,
    IncidentSort,
    IncidentStatusFilter,
    IncidentTypeFilter,
    PaymentIncidentDetailOut,
    PaymentIncidentSummaryOut,
)
from api.domains.admin.schemas import Page
from api.domains.admin.types import SortDirection
from api.errors import ConflictError, DomainError, NotFoundError
from api.integrations.toss import TossClient

DEFAULT_PAGE_LIMIT = 20
MAX_PAGE_LIMIT = 100
RECONCILIATION_TTL = timedelta(minutes=15)

_SENSITIVE_KEYS = {
    "authorization",
    "email",
    "payment_key",
    "paymentkey",
    "phone",
    "secret",
    "token",
}


def _sanitize(value: Any, *, key: str | None = None) -> Any:
    if key is not None:
        normalized = key.lower().replace("-", "_")
        if normalized in _SENSITIVE_KEYS or normalized.endswith(
            ("_email", "_phone", "_payment_key", "_secret", "_token")
        ):
            return "[redacted]"
    if isinstance(value, dict):
        return {str(k): _sanitize(v, key=str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _filters(
    *,
    incident_type: IncidentTypeFilter,
    status: IncidentStatusFilter,
    start_date: date | None,
    end_date: date | None,
) -> list[ColumnElement[bool]]:
    filters: list[ColumnElement[bool]] = []
    if incident_type != "all":
        filters.append(PaymentIncident.incident_type == incident_type)
    if status != "all":
        filters.append(PaymentIncident.status == status)
    if start_date is not None or end_date is not None:
        start = start_date or end_date
        end = end_date or start_date
        assert start is not None and end is not None
        start_at, end_at = kst_day_bounds(start, end)
        assert start_at is not None and end_at is not None
        filters.extend(
            (PaymentIncident.created_at >= start_at, PaymentIncident.created_at < end_at)
        )
    return filters


def _sort_clauses(sort: IncidentSort, direction: SortDirection) -> tuple[Any, Any]:
    columns = {
        "created_at": PaymentIncident.created_at,
        "updated_at": PaymentIncident.updated_at,
        "status": PaymentIncident.status,
        "incident_type": PaymentIncident.incident_type,
    }
    column = columns[sort]
    if direction == "asc":
        return column.asc(), PaymentIncident.id.asc()
    return column.desc(), PaymentIncident.id.desc()


def _summary(incident: PaymentIncident) -> PaymentIncidentSummaryOut:
    return PaymentIncidentSummaryOut.model_validate(incident, from_attributes=True)


def _reconciliation_blocker(incident: PaymentIncident) -> str | None:
    evidence = (incident.details or {}).get("reconciliation")
    if not isinstance(evidence, dict):
        return "먼저 Toss 상태를 대사해야 합니다"
    checked_at_raw = evidence.get("checked_at")
    try:
        checked_at = datetime.fromisoformat(str(checked_at_raw))
    except ValueError:
        return "대사 결과 시각이 올바르지 않습니다"
    if checked_at.tzinfo is None or datetime.now(UTC) - checked_at > RECONCILIATION_TTL:
        return "최근 15분 이내의 대사 결과가 필요합니다"
    if not evidence.get("provider_ok"):
        return "Toss 결제 조회가 성공하지 않았습니다"
    if not evidence.get("provider_order_id_matches"):
        return "Toss 주문 식별자가 내부 결제 그룹과 일치하지 않습니다"
    if not evidence.get("provider_status_matches"):
        return "Toss 결제 상태가 예상 상태와 일치하지 않습니다"
    if not evidence.get("amount_matches"):
        return "Toss 금액과 예상 금액이 일치하지 않습니다"
    if not evidence.get("domain_consistent"):
        return str(
            evidence.get("unsupported_reason") or "도메인 상태 자동 대사가 지원되지 않습니다"
        )
    return None


def _actions(incident: PaymentIncident, *, actor_role: str) -> list[IncidentAdminAction]:
    is_admin = actor_role == "admin"
    if incident.status == "resolved":
        resolved_reason = "이미 해결된 결제 이상입니다"
        return [
            IncidentAdminAction(
                kind="reconcile",
                label="Toss 상태 대사",
                enabled=False,
                blocking_reason=resolved_reason,
            ),
            IncidentAdminAction(
                kind="resolve",
                label="이상 해결",
                enabled=False,
                blocking_reason=resolved_reason,
                requires_memo=True,
            ),
        ]
    role_reason = None if is_admin else "최고 관리자 권한이 필요합니다"
    resolution_reason = role_reason or _reconciliation_blocker(incident)
    return [
        IncidentAdminAction(
            kind="reconcile",
            label="Toss 상태 대사",
            enabled=is_admin,
            blocking_reason=role_reason,
        ),
        IncidentAdminAction(
            kind="resolve",
            label="이상 해결",
            enabled=resolution_reason is None,
            blocking_reason=resolution_reason,
            requires_memo=True,
            destructive=True,
        ),
    ]


async def list_incidents(
    session: AsyncSession,
    *,
    incident_type: IncidentTypeFilter,
    status: IncidentStatusFilter,
    start_date: date | None,
    end_date: date | None,
    sort: IncidentSort,
    direction: SortDirection,
    limit: int,
    offset: int,
) -> Page[PaymentIncidentSummaryOut]:
    filters = _filters(
        incident_type=incident_type,
        status=status,
        start_date=start_date,
        end_date=end_date,
    )
    total = int(
        await session.scalar(select(func.count()).select_from(PaymentIncident).where(*filters)) or 0
    )
    primary_sort, id_sort = _sort_clauses(sort, direction)
    incidents = list(
        await session.scalars(
            select(PaymentIncident)
            .where(*filters)
            .order_by(primary_sort, id_sort)
            .limit(limit)
            .offset(offset)
        )
    )
    return Page[PaymentIncidentSummaryOut](
        items=[_summary(incident) for incident in incidents],
        total=total,
        limit=limit,
        offset=offset,
    )


async def get_incident_detail(
    session: AsyncSession, incident_id: uuid.UUID, *, actor_role: str
) -> PaymentIncidentDetailOut:
    incident = await session.get(PaymentIncident, incident_id)
    if incident is None:
        raise NotFoundError("Payment incident not found")
    order_number = None
    if incident.order_id is not None:
        order_number = await session.scalar(
            select(Order.order_number).where(Order.id == incident.order_id)
        )
    claim_number = None
    if incident.claim_id is not None:
        claim_number = await session.scalar(
            select(Claim.claim_number).where(Claim.id == incident.claim_id)
        )
    return PaymentIncidentDetailOut(
        **_summary(incident).model_dump(),
        details=_sanitize(incident.details or {}),
        resolution_memo=incident.resolution_memo,
        order_number=order_number,
        claim_number=claim_number,
        admin_actions=_actions(incident, actor_role=actor_role),
    )


async def _related_order(session: AsyncSession, incident: PaymentIncident) -> Order:
    order_id = incident.order_id
    if order_id is None and incident.claim_id is not None:
        order_id = await session.scalar(select(Claim.order_id).where(Claim.id == incident.claim_id))
    order = await session.get(Order, order_id) if order_id is not None else None
    if order is None:
        raise ConflictError("결제 이상과 연결된 주문이 없습니다", code="missing_order")
    if not order.payment_key:
        raise ConflictError("결제 조회 정보가 없습니다", code="missing_payment_key")
    return order


async def _expected_amount(session: AsyncSession, incident: PaymentIncident, order: Order) -> int:
    if incident.expected_amount is not None:
        return incident.expected_amount
    if incident.incident_type in ("refund", "partial_cancel") and incident.claim_id is not None:
        claim = await session.get(Claim, incident.claim_id)
        refund_amount = (claim.refund_data or {}).get("refund_amount") if claim else None
        if isinstance(refund_amount, int) and refund_amount >= 0:
            return refund_amount
    if order.payment_group_id is not None:
        grouped_total = await session.scalar(
            select(func.coalesce(func.sum(Order.total_price), 0)).where(
                Order.payment_group_id == order.payment_group_id
            )
        )
        return int(grouped_total or 0)
    return order.total_price


def _observed_amount(incident_type: str, payment: dict[str, Any]) -> int | None:
    if incident_type not in ("refund", "partial_cancel"):
        amount = payment.get("totalAmount")
        return amount if isinstance(amount, int) and amount >= 0 else None
    cancels = payment.get("cancels")
    if isinstance(cancels, list):
        amounts: list[int] = []
        for row in cancels:
            if not isinstance(row, dict):
                continue
            amount = row.get("cancelAmount")
            if isinstance(amount, int):
                amounts.append(amount)
        if amounts:
            return sum(amounts)
    total, balance = payment.get("totalAmount"), payment.get("balanceAmount")
    if isinstance(total, int) and isinstance(balance, int) and total >= balance >= 0:
        return total - balance
    return None


async def _reconcile_domain_state(
    session: AsyncSession,
    incident: PaymentIncident,
    order: Order,
    *,
    actor_id: uuid.UUID,
) -> tuple[bool, str]:
    if incident.incident_type in ("partial_cancel", "mixed_state"):
        return False, "reconciliation_not_supported"
    if incident.incident_type in ("confirm", "amount_mismatch"):
        if order.payment_group_id is None:
            return False, "missing_payment_group"
        payment_key = order.payment_key
        if payment_key is None:
            return False, "missing_payment_key"
        from api.domains.payments.service import reconcile_confirmed_payment

        return await reconcile_confirmed_payment(
            session,
            group_id=order.payment_group_id,
            payment_key=payment_key,
            actor_id=actor_id,
        )
    claim = await session.get(Claim, incident.claim_id) if incident.claim_id else None
    if claim is not None and claim.type == "token_refund":
        from api.domains.tokens.ledger import reconcile_approved_refund

        return await reconcile_approved_refund(
            session,
            claim_id=claim.id,
            actor_id=actor_id,
        )
    consistent = order.status == "취소" and (claim is None or claim.status == "완료")
    return consistent, "already_consistent" if consistent else "refund_apply_not_supported"


async def reconcile_incident(
    session: AsyncSession,
    toss: TossClient,
    incident_id: uuid.UUID,
    *,
    actor_id: uuid.UUID,
) -> PaymentIncident:
    incident = await session.get(PaymentIncident, incident_id)
    if incident is None:
        raise NotFoundError("Payment incident not found")
    if incident.status == "resolved":
        return incident
    order = await _related_order(session, incident)
    expected_amount = await _expected_amount(session, incident, order)
    incident_type = incident.incident_type
    payment_group_id = order.payment_group_id
    payment_key = order.payment_key
    assert payment_key is not None
    lookup_error: str | None = None
    try:
        result = await toss.get_payment(payment_key)
        provider_ok = result.ok
        provider_http_status = result.status
        payment = result.body if isinstance(result.body, dict) else {}
    except Exception as exc:
        await session.rollback()
        lookup_error = type(exc).__name__
        provider_ok = False
        provider_http_status = 0
        payment = {}
    observed_amount = _observed_amount(incident_type, payment)
    expected_provider_statuses = (
        {"CANCELED", "PARTIAL_CANCELED"}
        if incident_type == "refund"
        else {"PARTIAL_CANCELED"}
        if incident_type == "partial_cancel"
        else {"DONE"}
    )
    provider_order_id_matches = payment_group_id is not None and payment.get("orderId") == str(
        payment_group_id
    )
    provider_status_matches = payment.get("status") in expected_provider_statuses
    amount_matches = observed_amount == expected_amount
    domain_consistent = False
    apply_result = "not_attempted"
    if provider_ok and provider_order_id_matches and provider_status_matches and amount_matches:
        try:
            domain_consistent, apply_result = await _reconcile_domain_state(
                session,
                incident,
                order,
                actor_id=actor_id,
            )
        except Exception as exc:
            await session.rollback()
            apply_result = f"db_apply_failed:{type(exc).__name__}"
    evidence = {
        "checked_at": datetime.now(UTC).isoformat(),
        "provider_ok": provider_ok,
        "provider_http_status": provider_http_status,
        "provider_error_type": lookup_error,
        "provider_status": (
            payment.get("status") if isinstance(payment.get("status"), str) else None
        ),
        "provider_order_id_matches": provider_order_id_matches,
        "provider_status_matches": provider_status_matches,
        "expected_amount": expected_amount,
        "observed_amount": observed_amount,
        "amount_matches": amount_matches,
        "domain_consistent": domain_consistent,
        "apply_result": apply_result,
        "unsupported_reason": None if domain_consistent else apply_result,
    }

    incident = await session.scalar(
        select(PaymentIncident).where(PaymentIncident.id == incident_id).with_for_update()
    )
    assert incident is not None
    if incident.status == "resolved":
        return incident
    sanitized_details = _sanitize(incident.details or {})
    assert isinstance(sanitized_details, dict)
    sanitized_details["reconciliation"] = evidence
    incident.details = sanitized_details
    incident.expected_amount = expected_amount
    incident.observed_amount = observed_amount
    await session.commit()
    await session.refresh(incident)
    return incident


async def _current_domain_consistent(
    session: AsyncSession,
    incident: PaymentIncident,
) -> bool:
    order = await _related_order(session, incident)
    payment_key = order.payment_key
    assert payment_key is not None
    if incident.incident_type in ("confirm", "amount_mismatch"):
        if order.payment_group_id is None:
            return False
        from api.domains.payments.service import confirmed_payment_is_consistent

        return await confirmed_payment_is_consistent(
            session,
            group_id=order.payment_group_id,
            payment_key=payment_key,
        )
    if incident.incident_type in ("partial_cancel", "mixed_state"):
        return False
    if incident.claim_id is not None:
        claim_type = await session.scalar(select(Claim.type).where(Claim.id == incident.claim_id))
        if claim_type == "token_refund":
            from api.domains.tokens.ledger import token_refund_is_consistent

            return await token_refund_is_consistent(
                session,
                claim_id=incident.claim_id,
            )
    locked_order = await session.scalar(
        select(Order)
        .where(Order.id == order.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked_order is None or locked_order.status != "취소":
        return False
    if incident.claim_id is None:
        return True
    claim = await session.scalar(
        select(Claim).where(Claim.id == incident.claim_id).with_for_update()
    )
    return claim is not None and claim.status == "완료"


async def resolve_incident(
    session: AsyncSession,
    *,
    incident_id: uuid.UUID,
    actor_id: uuid.UUID,
    operation_id: uuid.UUID,
    memo: str,
    request_id: str,
) -> PaymentIncident:
    normalized_memo = memo.strip()
    if not normalized_memo:
        raise DomainError("해결 사유를 입력해주세요", code="memo_required")
    payload = {"memo": normalized_memo}
    existing_result = await idempotent_result(
        session,
        operation_id=operation_id,
        action="resolve_payment_incident",
        target_type="payment_incident",
        target_id=str(incident_id),
        payload=payload,
    )
    if existing_result is not None:
        incident = await session.get(PaymentIncident, incident_id)
        if incident is None:
            raise NotFoundError("Payment incident not found")
        return incident

    incident = await session.scalar(
        select(PaymentIncident).where(PaymentIncident.id == incident_id).with_for_update()
    )
    if incident is None:
        raise NotFoundError("Payment incident not found")
    existing_result = await idempotent_result(
        session,
        operation_id=operation_id,
        action="resolve_payment_incident",
        target_type="payment_incident",
        target_id=str(incident_id),
        payload=payload,
    )
    if existing_result is not None:
        return incident
    if incident.status == "resolved":
        if incident.resolution_memo == normalized_memo:
            return incident
        raise ConflictError("이미 다른 사유로 해결된 결제 이상입니다", code="already_resolved")
    blocker = _reconciliation_blocker(incident)
    if blocker is not None:
        raise ConflictError(blocker, code="reconciliation_required")
    if not await _current_domain_consistent(session, incident):
        raise ConflictError(
            "대사 이후 내부 상태가 변경되어 다시 대사해야 합니다",
            code="reconciliation_required",
        )

    before = {"status": incident.status, "observed_amount": incident.observed_amount}
    incident.status = "resolved"
    incident.resolution_memo = normalized_memo
    incident.resolved_by = actor_id
    resolved_at = datetime.now(UTC)
    incident.resolved_at = resolved_at
    after = {
        "id": str(incident.id),
        "status": "resolved",
        "resolution_memo": normalized_memo,
        "resolved_by": str(actor_id),
        "resolved_at": resolved_at.isoformat(),
    }
    record_operation(
        session,
        operation_id=operation_id,
        actor_id=actor_id,
        action="resolve_payment_incident",
        target_type="payment_incident",
        target_id=str(incident.id),
        target_count=1,
        reason=normalized_memo,
        payload=payload,
        before=before,
        after=after,
        request_id=request_id,
    )
    await session.commit()
    await session.refresh(incident)
    return incident
