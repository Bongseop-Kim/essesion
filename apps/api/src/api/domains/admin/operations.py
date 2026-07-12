"""관리자 고위험 변경의 멱등·감사 기록 공통부."""

import hashlib
import json
import uuid
from typing import Any

from db.models.commerce import AdminOperationLog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import advisory_xact_lock
from api.errors import ConflictError


def payload_hash(payload: Any) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


async def idempotent_result(
    session: AsyncSession,
    *,
    operation_id: uuid.UUID,
    action: str,
    target_type: str,
    target_id: str | None,
    payload: Any,
) -> dict[str, Any] | None:
    # 같은 멱등 키를 가진 동시 요청을 직렬화한다. 단순 조회 후 삽입만으로는
    # 둘 다 로그 부재를 관찰해 고유 제약에서 한 요청이 500으로 끝날 수 있다.
    await advisory_xact_lock(session, f"admin-operation:{operation_id}")
    existing = await session.scalar(
        select(AdminOperationLog).where(AdminOperationLog.operation_id == str(operation_id))
    )
    if existing is None:
        return None
    stored_hash = (existing.before_data or {}).get("payload_hash")
    if (
        existing.action != action
        or existing.target_type != target_type
        or existing.target_id != target_id
        or stored_hash != payload_hash(payload)
    ):
        raise ConflictError(
            "같은 operation_id에 다른 요청을 사용할 수 없습니다",
            code="operation_payload_conflict",
        )
    return existing.after_data or {}


def record_operation(
    session: AsyncSession,
    *,
    operation_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: str,
    target_type: str,
    target_id: str | None,
    target_count: int | None,
    reason: str,
    payload: Any,
    before: Any,
    after: dict[str, Any],
    request_id: str,
) -> None:
    session.add(
        AdminOperationLog(
            operation_id=str(operation_id),
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_count=target_count,
            reason=reason.strip(),
            before_data={"payload_hash": payload_hash(payload), "state": before},
            after_data=after,
            request_id=request_id,
        )
    )
