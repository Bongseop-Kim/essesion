"""미완료 차감 기록 — 프로세스 중단 복구의 대조 근거 (money.md §6).

차감 원장만으로는 모티프 생성·실사화가 결과를 남겼는지 판별할 수 없다. 그래서 차감과
같은 트랜잭션에 pending 기록을 남기고, 종결(성공·환불)에서 같은 트랜잭션으로 상태를 옮긴다.
프로세스가 그 사이에 죽으면 기한이 지난 pending을 복구 배치가 정확히 한 번 환불한다.

잠금 순서는 기존 돈 경로와 같다 — 사용자 advisory lock → 작업 행.
"""

import uuid
from datetime import UTC, datetime, timedelta

from db.models.tokens import TokenWork
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import USER_LOCK, advisory_xact_lock
from api.domains.tokens import ledger

# 기한 — 실제 호출 경로의 상한보다 길게 잡는다. worker 호출은 httpx 단계별
# `worker_timeout_seconds`(기본 180s)라 총 경과가 그 값 하나로 끝나지 않고, 뒤에 결과 조회·
# 라이브러리 저장·완성본 INSERT가 붙는다. 복구 배치가 5분마다 도므로 실제 환불은 기한 + 5분.
WORK_DEADLINE = timedelta(minutes=15)


def start(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: str,
    work_id: str,
) -> TokenWork:
    """pending 기록을 세션에 추가한다 — 커밋은 호출자가 차감과 **함께** 한다."""
    started_at = datetime.now(UTC)
    work = TokenWork(
        work_id=work_id,
        user_id=user_id,
        kind=kind,
        status="pending",
        started_at=started_at,
        deadline_at=started_at + WORK_DEADLINE,
    )
    session.add(work)
    return work


async def claim(
    session: AsyncSession,
    user_id: uuid.UUID,
    work_id: str,
    *,
    deadline_before: datetime | None = None,
) -> TokenWork | None:
    """종결 전환을 위해 기록을 잠근다 — 잠금 아래에서 상태·기한을 다시 검사한다.

    None이면 이미 종결된 기록이다(복구 배치가 먼저 환불했거나 이미 성공했다) —
    호출자는 결과나 라이브러리 링크를 뒤늦게 게시하지 않아야 한다.
    """
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user_id))
    query = select(TokenWork).where(TokenWork.work_id == work_id, TokenWork.status == "pending")
    if deadline_before is not None:
        query = query.where(TokenWork.deadline_at < deadline_before)
    return await session.scalar(query.with_for_update())


def finish(work: TokenWork, status: str, *, result_id: str | None = None) -> None:
    """종결 상태를 세션에 적는다 — 커밋은 호출자가 결과 INSERT와 함께 한다."""
    work.status = status
    work.finished_at = datetime.now(UTC)
    if result_id is not None:
        work.result_id = result_id


async def release(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    work_id: str,
    amount: int | None,
    deadline_before: datetime | None = None,
) -> bool:
    """미완료 기록을 환불로 종결한다 — 원장 반전과 refunded 전환을 한 트랜잭션으로.

    이미 종결된 기록이면 아무것도 하지 않고 False를 돌려준다(정확히 한 번 환불).
    `amount`가 None이면 실제 차감 배치를 그대로 반전한다(배치는 단가를 모른다).
    """
    await session.rollback()
    work = await claim(session, user_id, work_id, deadline_before=deadline_before)
    if work is None:
        await session.commit()
        return False
    await ledger.refund_failed_generation(session, user_id, amount, work_id, commit=False)
    finish(work, "refunded")
    await session.commit()
    return True
