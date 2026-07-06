from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from worker.config import Settings


def build_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(settings.database_url)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
