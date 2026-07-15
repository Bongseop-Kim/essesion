"""엔진·세션·advisory lock.

트랜잭션 규약: SQLAlchemy autobegin(의존성의 첫 쿼리부터 트랜잭션) 위에서 서비스
함수가 작업 후 **명시적으로 `await session.commit()`** — 커밋은 서비스 끝에서만.
get_session teardown은 정리 전용 — 응답 전송 후 실행되므로 여기서 커밋하면
"클라이언트는 200, DB는 유실" 사고가 난다.
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from api.config import Settings


def build_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
        pool_pre_ping=True,
    )


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]

# advisory lock 키 규약 — 획득 순서는 유저 락 → 채번 락 고정(데드락 예방)
USER_LOCK = "user:{user_id}"
NUMBERING_LOCK = "num:{prefix}:{date}"


async def advisory_xact_lock(session: AsyncSession, key: str) -> None:
    """pg_advisory_xact_lock — 실행 자체가 autobegin으로 트랜잭션을 열며,
    락은 그 트랜잭션의 커밋/롤백 시 해제된다. 락 이후의 보호 작업은 반드시
    같은 세션에서 commit 전에 끝낼 것."""
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": key})
