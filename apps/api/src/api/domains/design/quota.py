"""finalize 계정 쿼터 — 24시간 윈도우 내 generation_jobs 카운트 기반.

세션 카운터·건당 환불 대신 윈도우 내 job 행을 직접 센다. 실패·취소 job은
카운트에서 빠지므로 슬롯이 자동 해제된다 — 환불 로직이 필요 없다
(docs/api-spec/worker-pipeline.md §5). 한도는 admin_settings에서 읽고,
윈도우는 24시간 고정이다.
"""

import math
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from db.models.design import GenerationJob
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import advisory_xact_lock
from api.errors import ConflictError, DomainError
from api.pricing import get_admin_setting

FINALIZE_QUOTA_WINDOW = timedelta(hours=24)
FINALIZE_QUOTA_SETTING_KEY = "design_finalize_daily_limit"
FINALIZE_UNCOUNTED_STATUSES = ("failed", "canceled")
# 토큰·결제의 USER_LOCK과 분리된 전용 키 — 금전 경로 락 순서와 결합하지 않는다.
FINALIZE_QUOTA_LOCK = "finalize-quota:{user_id}"


def parse_finalize_limit(value: str) -> int | None:
    clean = value.strip()
    if not clean.isdigit():
        return None
    parsed = int(clean)
    return parsed if 0 <= parsed <= 1000 else None


@dataclass(frozen=True)
class FinalizeQuota:
    limit: int
    used: int
    # 카운트된 최고령 job이 윈도우를 벗어나 슬롯이 하나 풀리는 시각. 카운트 0이면 None.
    reset_at: datetime | None

    @property
    def remaining(self) -> int:
        # 관리자가 한도를 현 사용량 미만으로 낮출 수 있다 — 음수 대신 0.
        return max(0, self.limit - self.used)


async def load_finalize_limit(session: AsyncSession) -> int | None:
    """설정 행이 없으면 None — 표시용 호출부(GET 세션)는 관대하게 null로 넘긴다."""
    value = await get_admin_setting(session, FINALIZE_QUOTA_SETTING_KEY)
    if value is None:
        return None
    limit = parse_finalize_limit(value)
    if limit is None:
        raise DomainError(
            "실사화 24시간 한도 설정이 올바르지 않습니다",
            code="invalid_configuration",
            status=503,
        )
    return limit


async def get_finalize_quota(
    session: AsyncSession,
    user_id: uuid.UUID,
    limit: int,
    *,
    now: datetime | None = None,
) -> FinalizeQuota:
    if now is None:
        now = datetime.now(UTC)
    used, oldest = (
        await session.execute(
            select(func.count(), func.min(GenerationJob.created_at)).where(
                GenerationJob.user_id == user_id,
                GenerationJob.kind == "finalize",
                GenerationJob.created_at >= now - FINALIZE_QUOTA_WINDOW,
                GenerationJob.status.not_in(FINALIZE_UNCOUNTED_STATUSES),
            )
        )
    ).one()
    reset_at = None if oldest is None else oldest + FINALIZE_QUOTA_WINDOW
    return FinalizeQuota(limit=limit, used=used, reset_at=reset_at)


async def acquire_finalize_quota(session: AsyncSession, user_id: uuid.UUID) -> FinalizeQuota:
    """한도 검사로 슬롯을 확보한다 — 같은 계정의 동시 요청은 advisory lock으로 직렬화.

    호출부는 같은 트랜잭션에서 job을 INSERT하고 커밋해야 한다(락은 커밋 시 해제 —
    뒤이은 요청이 커밋된 job까지 세게 된다). stale queued job은 회수(최대 75분)
    전까지 슬롯을 차지한다 — 허용된 트레이드오프.
    """
    limit = await load_finalize_limit(session)
    if limit is None:
        raise DomainError(
            "실사화 24시간 한도 설정이 없습니다",
            code="missing_configuration",
            status=503,
        )
    await advisory_xact_lock(session, FINALIZE_QUOTA_LOCK.format(user_id=user_id))
    now = datetime.now(UTC)
    quota = await get_finalize_quota(session, user_id, limit, now=now)
    if quota.remaining <= 0:
        detail = f"최근 24시간 실사화 한도({limit}회)를 모두 사용했습니다."
        if quota.reset_at is not None:
            hours = max(1, math.ceil((quota.reset_at - now).total_seconds() / 3600))
            detail += f" 약 {hours}시간 후 다시 시도할 수 있습니다."
        raise ConflictError(detail, code="finalize_quota_exhausted")
    return quota
