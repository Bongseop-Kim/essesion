"""finalize job 수명주기 공유 로직 — 취소·stale 회수의 단일 전이 지점.

canceled 전이는 예산 환불과 항상 짝이다. 사용자 취소(design 라우터)와
TTL 회수(batch 배치·폴링 시 lazy)가 같은 헬퍼를 쓰므로 환불이 정확히
한 번만 일어난다 — 전이 조건(조건부 UPDATE 또는 행 잠금)이 중복을 막는다.
"""

import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta

from db.models.design import (
    FINALIZE_STALE_MESSAGE,
    FINALIZE_TEMPORARY_FAILURE_MARKER,
    DesignSession,
    GenerationJob,
)
from sqlalchemy import ColumnElement, and_, func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession

# Cloud Tasks 최대 4회가 각 910초 deadline을 소진한 최악의 장기 실패까지 기다린 뒤 회수한다.
STALE_GENERATION_JOB_AFTER = timedelta(minutes=75)
# worker finalize lease(960초)와 동일하게 최근 processing claim은 보호한다.
# 생성 TTL은 계속 진행되므로 transient 실패가 회수 시계를 리셋하지 않는다.
ACTIVE_GENERATION_JOB_LEASE = timedelta(seconds=960)

CANCELABLE_STATUSES = ("queued", "processing")


def stale_finalize_clause(now: datetime) -> ColumnElement[bool]:
    """TTL을 넘긴 채 종결되지 못한 finalize job 판정 — batch 회수·폴링 lazy 회수 공용."""
    cutoff = now - STALE_GENERATION_JOB_AFTER
    active_lease_cutoff = now - ACTIVE_GENERATION_JOB_LEASE
    return and_(
        GenerationJob.kind == "finalize",
        GenerationJob.created_at < cutoff,
        or_(
            GenerationJob.status == "queued",
            and_(
                GenerationJob.status == "processing",
                GenerationJob.updated_at < active_lease_cutoff,
            ),
            and_(
                GenerationJob.status == "failed",
                GenerationJob.error_message == FINALIZE_TEMPORARY_FAILURE_MARKER,
            ),
        ),
    )


async def refund_finalize_budget(session: AsyncSession, session_id: uuid.UUID) -> None:
    await session.execute(
        update(DesignSession)
        .where(DesignSession.id == session_id)
        .values(finalize_used=func.greatest(DesignSession.finalize_used - 1, 0))
    )


async def resolve_stale_finalize_jobs(
    session: AsyncSession, jobs: Iterable[GenerationJob]
) -> None:
    """행 잠금을 이미 확보한 stale job들을 canceled로 종결하고 예산을 복구한다."""
    for job in jobs:
        job.status = "canceled"
        job.result = None
        job.error_message = FINALIZE_STALE_MESSAGE
        if job.session_id is not None:
            await refund_finalize_budget(session, job.session_id)
