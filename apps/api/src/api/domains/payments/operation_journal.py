"""외부 결제 호출 전 영속하는 최소 operation journal.

`payment_incidents`의 open row가 준비 중이거나 결과가 불확실한 operation을 함께
표현한다. 정상 반영과 명시적 provider 거절만 resolved로 닫는다. 따라서 프로세스가
외부 호출 직전/직후 종료돼도 같은 row가 관리자 대사 queue에 남는다.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from db.models.commerce import PaymentIncident
from obs import request_id_var
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def prepare_payment_operation(
    session: AsyncSession,
    *,
    incident_type: str,
    actor_id: uuid.UUID,
    order_id: uuid.UUID,
    expected_amount: int,
    claim_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> PaymentIncident:
    operation = PaymentIncident(
        operation_id=str(uuid.uuid4()),
        incident_type=incident_type,
        status="open",
        request_id=request_id_var.get() or "unknown",
        actor_id=actor_id,
        order_id=order_id,
        claim_id=claim_id,
        expected_amount=expected_amount,
        details={"phase": "provider_call_pending", **(details or {})},
    )
    session.add(operation)
    return operation


async def set_payment_operation_outcome(
    session: AsyncSession,
    operation_id: uuid.UUID,
    *,
    phase: str,
    status: str = "open",
    resolved_by: uuid.UUID | None = None,
    resolution_memo: str | None = None,
    observed_amount: int | None = None,
    error_type: str | None = None,
    provider_http_status: int | None = None,
    provider_status: str | None = None,
) -> PaymentIncident:
    operation = await session.scalar(
        select(PaymentIncident)
        .where(PaymentIncident.id == operation_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if operation is None:
        raise RuntimeError("prepared payment operation is missing")

    operation.status = status
    operation.observed_amount = observed_amount
    operation.details = {
        **operation.details,
        "phase": phase,
        "error_type": error_type,
        "provider_http_status": provider_http_status,
        "provider_status": provider_status,
    }
    if status == "resolved":
        operation.resolved_by = resolved_by
        operation.resolved_at = datetime.now(UTC)
        operation.resolution_memo = resolution_memo or phase
    return operation


async def persist_payment_operation_outcome(
    session: AsyncSession,
    operation_id: uuid.UUID,
    **outcome: Any,
) -> PaymentIncident:
    """실패한 업무 transaction을 버린 뒤 operation 결과만 독립 commit한다."""

    await session.rollback()
    operation = await set_payment_operation_outcome(session, operation_id, **outcome)
    await session.commit()
    await session.refresh(operation)
    return operation
