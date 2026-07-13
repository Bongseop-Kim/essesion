import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from obs import RequestIdMiddleware, init_observability
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from worker.adapters import build_adapters
from worker.api import finalize_router, generate_router, router
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
        app.state.adapters = build_adapters(settings)
        yield
        await app.state.adapters.aclose()
        await engine.dispose()

    application = FastAPI(title="essesion worker", lifespan=lifespan)
    application.state.settings = settings
    application.add_middleware(RequestIdMiddleware)
    if settings.service_mode == "generate":
        application.include_router(generate_router)
    elif settings.service_mode == "finalize":
        application.include_router(finalize_router)
    else:
        application.include_router(router)

    @application.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/readyz", include_in_schema=False)
    async def readyz() -> JSONResponse:
        database = "bypassed"
        if settings.env not in ("local", "test"):

            async def ping_database() -> None:
                async with application.state.engine.connect() as connection:
                    await connection.execute(text("SELECT 1"))

            try:
                await asyncio.wait_for(ping_database(), timeout=3.0)
                database = "ready"
            except Exception:
                database = "unavailable"
        capabilities = {
            "database": database,
            "gcs_assets": application.state.object_store.capability_mode,
        }
        ready = all(mode not in {"unavailable"} for mode in capabilities.values())
        return JSONResponse(
            status_code=200 if ready else 503,
            content={
                "status": "ready" if ready else "not_ready",
                "capabilities": capabilities,
            },
        )

    return application


app = create_app()
