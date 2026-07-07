"""worker 테스트 기반 — 실제 Postgres(testcontainers, pgvector pg17), mock 금지(AGENTS.md).

컨테이너+마이그레이션은 세션당 1회, 격리는 테스트 후 TRUNCATE(앱이 실제 커밋). DB가 필요
없는 순수 단위 테스트(normalize/gate)는 이 픽스처를 쓰지 않으므로 컨테이너 기동과 무관하다.
"""

from collections.abc import AsyncIterator, Iterator

import pytest
from db.models import Base
from db.testing import migrated_postgres
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic_settings import SettingsConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from worker.config import Settings
from worker.main import create_app

TRUNCATE_SQL = "TRUNCATE {} RESTART IDENTITY CASCADE".format(
    ", ".join(t.name for t in Base.metadata.sorted_tables)
)


class _TestSettings(Settings):
    model_config = SettingsConfigDict(env_file=None)  # 개발자 로컬 .env 오염 차단


@pytest.fixture(scope="session")
def pg_url() -> Iterator[str]:
    with migrated_postgres() as url:
        yield url


@pytest.fixture
def settings(pg_url: str) -> Settings:
    # 시크릿은 비워 둔다(DryRun) — 어댑터가 필요한 테스트는 respx로 목킹하거나 클라이언트를 주입.
    return _TestSettings(database_url=pg_url, motif_render_check=False)


@pytest.fixture
async def app(settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application
        async with application.state.engine.begin() as conn:
            await conn.execute(text(TRUNCATE_SQL))


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def db_session(pg_url: str) -> AsyncIterator[AsyncSession]:
    """앱과 별개의 세션 — store/resolver 직접 테스트용. 테스트 후 TRUNCATE."""
    engine = create_async_engine(pg_url)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    async with sessionmaker() as session:
        yield session
    async with engine.begin() as conn:
        await conn.execute(text(TRUNCATE_SQL))
    await engine.dispose()
