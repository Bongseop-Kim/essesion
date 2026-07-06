"""api 테스트 기반 — 실제 Postgres(testcontainers), mock 금지(AGENTS.md).

컨테이너+마이그레이션은 세션당 1회, 격리는 테스트 후 TRUNCATE(앱이 실제 커밋을
하므로 세이브포인트 롤백 패턴은 부적합).
"""

from collections.abc import AsyncIterator, Iterator

import pytest
from api.config import Settings
from api.main import create_app
from db.models import Base
from db.testing import migrated_postgres
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic_settings import SettingsConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

TRUNCATE_SQL = "TRUNCATE {} RESTART IDENTITY CASCADE".format(
    ", ".join(t.name for t in Base.metadata.sorted_tables)
)


@pytest.fixture(scope="session")
def pg_url() -> Iterator[str]:
    with migrated_postgres() as url:
        yield url


class _TestSettings(Settings):
    model_config = SettingsConfigDict(env_file=None)  # 개발자의 로컬 .env 오염 차단


@pytest.fixture
def settings(pg_url: str) -> Settings:
    return _TestSettings(
        database_url=pg_url,
        jwt_secret="test-jwt-secret-0123456789abcdef",
        batch_token="test-batch-token",
        toss_secret_key="test-toss-secret",  # RealTossClient 사용 — respx로 목킹
    )


@pytest.fixture
async def app(settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application
        # 테스트 후 정리 — 세션 스코프 DB를 다음 테스트가 깨끗하게 받도록
        async with application.state.engine.begin() as conn:
            await conn.execute(text(TRUNCATE_SQL))


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def db_session(app: FastAPI) -> AsyncIterator[AsyncSession]:
    """테스트 데이터 준비·검증용 세션 (앱의 요청 세션과 별개)."""
    async with app.state.sessionmaker() as session:
        yield session
