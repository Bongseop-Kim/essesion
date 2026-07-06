"""엔진·세션·advisory lock.

트랜잭션 규약: 커밋은 서비스/라우터 함수의 `async with session.begin():` 안에서만.
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
    # 4단계: Cloud Run에서는 cloud-sql-python-connector(create_async_connector,
    # refresh_strategy="lazy")를 여기에 삽입 — 이 함수가 유일한 교체 지점.
    return create_async_engine(settings.database_url)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]

# advisory lock 키 규약 — 획득 순서는 유저 락 → 채번 락 고정(데드락 예방)
USER_LOCK = "user:{user_id}"
NUMBERING_LOCK = "num:{prefix}:{date}"


async def advisory_xact_lock(session: AsyncSession, key: str) -> None:
    """pg_advisory_xact_lock — 트랜잭션 커밋/롤백 시 자동 해제.

    트랜잭션 밖에서 부르면 즉시 해제되어 무의미하므로 assert로 차단한다.
    """
    assert session.in_transaction(), "advisory lock은 session.begin() 안에서만 유효"
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": key})
