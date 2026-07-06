from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from obs import RequestIdMiddleware, init_observability
from sqlalchemy.ext.asyncio import async_sessionmaker
from starlette.middleware.sessions import SessionMiddleware

from api.config import Settings, get_settings
from api.db import build_engine
from api.errors import register_error_handlers
from api.integrations.gcs import build_gcs_client
from api.integrations.solapi import build_solapi_client
from api.integrations.toss import build_toss_client

init_observability("api")


def _operation_id(route: APIRoute) -> str:
    # 함수명 고정 — 리팩토링에 안정적인 api-client 심볼명 (드리프트 소음 방지)
    return route.name


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = build_engine(settings)
        app.state.engine = engine
        app.state.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
        app.state.toss = build_toss_client(settings)
        app.state.solapi = build_solapi_client(settings)
        app.state.gcs = build_gcs_client(settings)
        yield
        await app.state.toss.aclose()
        await engine.dispose()

    app = FastAPI(
        title="essesion api",
        lifespan=lifespan,
        generate_unique_id_function=_operation_id,
    )
    app.state.settings = settings

    # add_middleware는 나중에 추가한 것이 바깥 — RequestId가 최외곽
    app.add_middleware(SessionMiddleware, secret_key=settings.session_secret)  # Authlib state
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestIdMiddleware)

    register_error_handlers(app)
    _include_routers(app)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


def _include_routers(app: FastAPI) -> None:
    # 도메인 라우터는 구현 단계마다 여기 추가
    pass


app = create_app()
