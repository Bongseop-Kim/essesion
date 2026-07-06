"""채번 — {PREFIX}-YYYYMMDD-NNN (docs/api-spec/money.md §1).

advisory lock으로 (prefix, 날짜) 직렬화 + 당일 max+1. 날짜는 DB now() 기준(원 동작).
락 획득 순서 규약: 유저 락(user:*)을 먼저, 채번 락은 나중 — 데드락 예방.
unique 제약이 최후 방어선(경합 시 IntegrityError → 호출부 재시도 1회 권장).
"""

from sqlalchemy import Integer, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from api.db import advisory_xact_lock


async def generate_number(session: AsyncSession, column: InstrumentedAttribute, prefix: str) -> str:
    date_str = await session.scalar(select(func.to_char(func.now(), "YYYYMMDD")))
    await advisory_xact_lock(session, f"num:{prefix}:{date_str}")
    max_seq = await session.scalar(
        select(func.max(func.split_part(column, "-", 3).cast(Integer))).where(
            column.like(f"{prefix}-{date_str}-%")
        )
    )
    return f"{prefix}-{date_str}-{(max_seq or 0) + 1:03d}"
