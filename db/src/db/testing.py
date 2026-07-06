"""테스트용 실제 Postgres 헬퍼 — 인가·마이그레이션 테스트는 mock 금지(AGENTS.md).

3단계 api 인가 테스트의 conftest가 재사용한다:
    with migrated_postgres() as url: ...  # asyncpg URL, 스키마 적용 완료 상태
"""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from testcontainers.postgres import PostgresContainer

ALEMBIC_INI = Path(__file__).parents[2] / "alembic.ini"  # 편집 설치(uv workspace) 전제
POSTGRES_IMAGE = "pgvector/pgvector:pg17"  # docker-compose.yml과 동일 이미지


def alembic_config(url: str) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


@contextmanager
def migrated_postgres() -> Iterator[str]:
    """pgvector Postgres 컨테이너 기동 + alembic upgrade head → asyncpg URL 반환."""
    with PostgresContainer(POSTGRES_IMAGE, driver="asyncpg") as pg:
        url = pg.get_connection_url()
        command.upgrade(alembic_config(url), "head")
        yield url
