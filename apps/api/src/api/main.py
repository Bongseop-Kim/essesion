import asyncio
import hmac
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from obs import RequestIdMiddleware, init_observability
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker
from starlette.middleware.sessions import SessionMiddleware

from api.config import Settings, get_settings
from api.db import build_engine
from api.deps import batch_auth_capability_mode
from api.domains.auth.oauth import build_oauth
from api.domains.auth.rate_limit import AuthRateLimiter, RecentKeyCache
from api.errors import SECURITY_RESPONSE_HEADERS, register_error_handlers
from api.integrations.gcs import assets_capability_mode, build_gcs_client
from api.integrations.solapi import build_solapi_client
from api.integrations.tasks import build_task_queue
from api.integrations.toss import build_toss_client
from api.integrations.worker import build_worker_client

init_observability("api")


class EdgeBoundaryMiddleware:
    """비로컬 공개 API를 신뢰된 Cloudflare 프록시 뒤로 제한한다."""

    _HEADER = b"x-essesion-edge-secret"

    def __init__(
        self,
        app,
        *,
        environment: str,
        edge_proxy_secret: str,
    ):  # noqa: ANN001 — ASGI app
        self.app = app
        self.verify_edge = environment not in ("local", "test")
        self.edge_proxy_secret = edge_proxy_secret

    @staticmethod
    def _is_exempt_path(path: str) -> bool:
        return path == "/healthz" or path.startswith("/batch/")

    async def __call__(self, scope, receive, send):  # noqa: ANN001 — ASGI protocol
        if scope["type"] != "http" or not self.verify_edge or self._is_exempt_path(scope["path"]):
            return await self.app(scope, receive, send)

        if not self.edge_proxy_secret:
            response = JSONResponse(
                status_code=503,
                content={
                    "detail": "API 엣지 프록시 검증을 사용할 수 없습니다.",
                    "code": "service_unavailable",
                },
                headers={"Cache-Control": "no-store"},
            )
            return await response(scope, receive, send)

        edge_values = [
            value.decode("latin-1")
            for key, value in scope["headers"]
            if key.lower() == self._HEADER
        ]
        if len(edge_values) != 1 or not hmac.compare_digest(edge_values[0], self.edge_proxy_secret):
            response = JSONResponse(
                status_code=403,
                content={
                    "detail": "API 엣지 프록시 검증에 실패했습니다.",
                    "code": "forbidden",
                },
                headers={"Cache-Control": "no-store"},
            )
            return await response(scope, receive, send)

        return await self.app(scope, receive, send)


class AdminBoundaryMiddleware:
    """관리자 브라우저 경계: exact Origin 검증과 민감 응답 캐시 금지."""

    def __init__(
        self,
        app,
        *,
        allowed_origin: str,
    ):  # noqa: ANN001 — ASGI app
        self.app = app
        self.allowed_origin = allowed_origin

    @staticmethod
    def _is_admin_path(path: str) -> bool:
        return (
            path == "/admin"
            or path.startswith("/admin/")
            or path == "/auth/admin"
            or path.startswith("/auth/admin/")
        )

    async def __call__(self, scope, receive, send):  # noqa: ANN001 — ASGI protocol
        if scope["type"] != "http" or not self._is_admin_path(scope["path"]):
            return await self.app(scope, receive, send)

        origins = [
            value.decode("latin-1") for key, value in scope["headers"] if key.lower() == b"origin"
        ]
        if origins != [self.allowed_origin]:
            response = JSONResponse(
                status_code=403,
                content={
                    "detail": "관리자 Origin이 올바르지 않습니다.",
                    "code": "forbidden",
                },
                headers={"Cache-Control": "no-store"},
            )
            return await response(scope, receive, send)

        async def send_no_store(message):  # noqa: ANN001 — ASGI protocol
            if message["type"] == "http.response.start":
                headers = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() != b"cache-control"
                ]
                headers.append((b"cache-control", b"no-store"))
                message["headers"] = headers
            await send(message)

        return await self.app(scope, receive, send_no_store)


class SecurityHeadersMiddleware:
    _HEADERS = tuple(
        (name.lower().encode("ascii"), value.encode("ascii"))
        for name, value in SECURITY_RESPONSE_HEADERS.items()
    )

    def __init__(self, app):  # noqa: ANN001 — ASGI app
        self.app = app

    async def __call__(self, scope, receive, send):  # noqa: ANN001 — ASGI protocol
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_security_headers(message):  # noqa: ANN001 — ASGI protocol
            if message["type"] == "http.response.start":
                managed = {key for key, _ in self._HEADERS}
                headers = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() not in managed
                ]
                headers.extend(self._HEADERS)
                message["headers"] = headers
            await send(message)

        return await self.app(scope, receive, send_with_security_headers)


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
        app.state.capabilities = {
            "toss": app.state.toss.capability_mode,
            "gcs": app.state.gcs.capability_mode,
            "gcs_assets": assets_capability_mode(settings),
            "solapi": app.state.solapi.capability_mode,
            "worker": app.state.worker.capability_mode,
            "finalize_tasks": app.state.tasks.capability_mode,
            "batch_auth": batch_auth_capability_mode(settings),
            "oauth_google": (
                "optional"
                if settings.env in ("local", "test")
                else "ready"
                if settings.google_client_id and settings.google_client_secret
                else "unavailable"
            ),
            "oauth_kakao": (
                "optional"
                if settings.env in ("local", "test")
                else "ready"
                if settings.kakao_client_id and settings.kakao_client_secret
                else "unavailable"
            ),
            "auth_secrets": (
                "bypassed"
                if settings.env in ("local", "test")
                else "ready"
                if len(settings.jwt_secret) >= 32
                and settings.jwt_secret != "dev-jwt-secret-only-for-local-32b!"
                and len(settings.session_secret) >= 32
                and settings.session_secret != "dev-session-secret"
                else "unavailable"
            ),
            "edge_proxy": (
                "bypassed"
                if settings.env in ("local", "test")
                else "ready"
                if settings.edge_proxy_secret
                else "unavailable"
            ),
        }
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
    app.state.admin_auth_rate_limiter = AuthRateLimiter(
        attempts=settings.admin_auth_rate_limit_attempts,
        window_seconds=settings.admin_auth_rate_limit_window_seconds,
        max_keys=settings.admin_auth_rate_limit_max_keys,
    )
    app.state.store_auth_rate_limiter = AuthRateLimiter(
        attempts=settings.store_auth_rate_limit_attempts,
        window_seconds=settings.store_auth_rate_limit_window_seconds,
        max_keys=settings.public_rate_limit_max_keys,
        detail="로그인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    )
    app.state.phone_verify_rate_limiter = AuthRateLimiter(
        attempts=settings.phone_verify_rate_limit_attempts,
        window_seconds=settings.phone_verify_rate_limit_window_seconds,
        max_keys=settings.public_rate_limit_max_keys,
        detail="전화번호 인증 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    )
    app.state.toss_webhook_rate_limiter = AuthRateLimiter(
        attempts=settings.toss_webhook_rate_limit_attempts,
        window_seconds=settings.toss_webhook_rate_limit_window_seconds,
        max_keys=settings.public_rate_limit_max_keys,
        detail="결제 웹훅 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    )
    app.state.toss_invalid_payment_keys = RecentKeyCache(
        ttl_seconds=settings.toss_invalid_key_cache_ttl_seconds,
        max_keys=settings.public_rate_limit_max_keys,
    )

    # add_middleware는 나중에 추가한 것이 바깥 — RequestId가 최외곽
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        https_only=settings.env not in ("local", "test"),
    )  # Authlib state
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(dict.fromkeys([*settings.cors_origins, settings.admin_frontend_origin])),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(
        AdminBoundaryMiddleware,
        allowed_origin=settings.admin_frontend_origin,
    )
    app.add_middleware(
        EdgeBoundaryMiddleware,
        environment=settings.env,
        edge_proxy_secret=settings.edge_proxy_secret,
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)

    register_error_handlers(app)
    _include_routers(app)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", include_in_schema=False)
    async def readyz(request: Request) -> JSONResponse:
        capabilities = dict(request.app.state.capabilities)
        if settings.env in ("local", "test"):
            capabilities["database"] = "bypassed"
        else:
            try:
                async with asyncio.timeout(3.0):
                    async with request.app.state.engine.connect() as connection:
                        await connection.execute(text("SELECT 1"))
                capabilities["database"] = "ready"
            except Exception:
                capabilities["database"] = "unavailable"
        ready = all(mode != "unavailable" for mode in capabilities.values())
        return JSONResponse(
            status_code=200 if ready else 503,
            content={
                "status": "ready" if ready else "not_ready",
                "capabilities": capabilities,
            },
        )

    return app


def _include_routers(app: FastAPI) -> None:
    from api.domains.admin.configuration import router as admin_configuration_router
    from api.domains.admin.coupons import router as admin_coupons_router
    from api.domains.admin.customers import router as admin_customers_router
    from api.domains.admin.entity_images import router as admin_entity_images_router
    from api.domains.admin.generation import router as admin_generation_router
    from api.domains.admin.inquiries import router as admin_inquiries_router
    from api.domains.admin.manual_orders import router as admin_manual_orders_router
    from api.domains.admin.phase_d_router import router as admin_phase_d_router
    from api.domains.admin.products import router as admin_products_router
    from api.domains.admin.quotes import router as admin_quotes_router
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
    app.include_router(admin_customers_router)
    app.include_router(admin_coupons_router)
    app.include_router(admin_products_router)
    app.include_router(admin_quotes_router)
    app.include_router(admin_entity_images_router)
    app.include_router(admin_inquiries_router)
    app.include_router(admin_manual_orders_router)
    app.include_router(admin_configuration_router)
    app.include_router(admin_phase_d_router)
    app.include_router(admin_generation_router)
    app.include_router(batch_router)


app = create_app()
