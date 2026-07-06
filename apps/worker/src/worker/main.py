from contextlib import asynccontextmanager

from fastapi import FastAPI
from obs import RequestIdMiddleware, init_observability
from sqlalchemy.ext.asyncio import async_sessionmaker

from worker.api import router
from worker.config import Settings, get_settings
from worker.db import build_engine
from worker.integrations import build_object_store

init_observability("worker")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = build_engine(settings)
        app.state.engine = engine
        app.state.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
        app.state.object_store = build_object_store(settings)
        yield
        await engine.dispose()

    application = FastAPI(title="essesion worker", lifespan=lifespan)
    application.state.settings = settings
    application.add_middleware(RequestIdMiddleware)
    application.include_router(router)

    @application.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return application


app = create_app()
