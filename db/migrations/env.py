import asyncio
import logging
import os

import pgvector.sqlalchemy
from alembic import context
from db.models import Base
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

logging.basicConfig(level=logging.INFO, format="%(levelname)s [alembic] %(message)s")

config = context.config

if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option(
        "sqlalchemy.url",
        os.environ.get(
            "DATABASE_URL", "postgresql+asyncpg://essesion:essesion@localhost:5432/essesion"
        ),
    )

target_metadata = Base.metadata


def render_item(type_, obj, autogen_context):  # noqa: ANN001 — alembic 훅 시그니처
    """autogenerate가 Vector 타입을 임포트 없이 렌더링하는 문제 방지."""
    if type_ == "type" and isinstance(obj, pgvector.sqlalchemy.Vector):
        autogen_context.imports.add("import pgvector.sqlalchemy")
        return f"pgvector.sqlalchemy.Vector(dim={obj.dim})"
    return False


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
