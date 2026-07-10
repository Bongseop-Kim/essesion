from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from obs import RequestIdMiddleware, init_observability
from sqlalchemy.ext.asyncio import async_sessionmaker
from starlette.middleware.sessions import SessionMiddleware

from api.config import Settings, get_settings
from api.db import build_engine
from api.domains.auth.oauth import build_oauth
from api.errors import register_error_handlers
from api.integrations.gcs import build_gcs_client
from api.integrations.solapi import build_solapi_client
from api.integrations.tasks import build_task_queue
from api.integrations.toss import build_toss_client
from api.integrations.worker import build_worker_client

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
        app.state.worker = build_worker_client(settings)
        app.state.tasks = build_task_queue(settings)
        yield
        await app.state.worker.aclose()
        await app.state.toss.aclose()
        await engine.dispose()

    app = FastAPI(
        title="essesion api",
        lifespan=lifespan,
        generate_unique_id_function=_operation_id,
    )
    app.state.settings = settings
    app.state.oauth = build_oauth(settings)

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
    from api.domains.admin.router import router as admin_router
    from api.domains.auth.router import router as auth_router
    from api.domains.batch.router import router as batch_router
    from api.domains.cart.router import router as cart_router
    from api.domains.claims.router import router as claims_router
    from api.domains.coupons.router import router as coupons_router
    from api.domains.design.router import router as design_router
    from api.domains.images.router import router as images_router
    from api.domains.inquiries.router import router as inquiries_router
    from api.domains.orders.router import router as orders_router
    from api.domains.payments.router import router as payments_router
    from api.domains.products.router import router as products_router
    from api.domains.quotes.router import router as quotes_router
    from api.domains.reform.router import router as reform_router
    from api.domains.tokens.router import router as tokens_router
    from api.domains.users.router import router as users_router

    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(products_router)
    app.include_router(cart_router)
    app.include_router(coupons_router)
    app.include_router(orders_router)
    app.include_router(payments_router)
    app.include_router(tokens_router)
    app.include_router(claims_router)
    app.include_router(quotes_router)
    app.include_router(inquiries_router)
    app.include_router(images_router)
    app.include_router(reform_router)
    app.include_router(design_router)
    app.include_router(admin_router)
    app.include_router(batch_router)


app = create_app()
