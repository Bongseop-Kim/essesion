"""도메인 예외 → {"detail": <한국어 원문>, "code": <slug>} 응답.

detail의 한국어 메시지는 기존 시스템의 프론트 노출 계약 — docs/api-spec/domains.md §11.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from obs import request_id_var, sanitize_request_id
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)

SECURITY_RESPONSE_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}


class ErrorResponse(BaseModel):
    detail: str
    code: str = "domain_error"


class DomainError(Exception):
    status = 400
    code = "domain_error"

    def __init__(self, detail: str, *, code: str | None = None, status: int | None = None):
        super().__init__(detail)
        self.detail = detail
        if code is not None:
            self.code = code
        if status is not None:
            self.status = status


class UnauthorizedError(DomainError):
    status = 401
    code = "unauthorized"

    def __init__(self, detail: str = "로그인이 필요합니다"):
        super().__init__(detail)


class ForbiddenError(DomainError):
    status = 403
    code = "forbidden"

    def __init__(self, detail: str = "권한이 없습니다"):
        super().__init__(detail)


class NotFoundError(DomainError):
    status = 404
    code = "not_found"

    def __init__(self, detail: str = "찾을 수 없습니다"):
        super().__init__(detail)


class ConflictError(DomainError):
    status = 409
    code = "conflict"


class RateLimitedError(DomainError):
    status = 429
    code = "rate_limited"


class UpstreamError(DomainError):
    """외부 연동(Toss·Solapi 등) 실패."""

    status = 502
    code = "upstream_error"


class ServiceUnavailableError(DomainError):
    status = 503
    code = "service_unavailable"


class WorkerRequestError(DomainError):
    """워커가 요청 자체를 거부(400/422) — 일시 장애가 아니라 재시도 무의미한 요청 오류."""

    status = 422
    code = "worker_rejected"


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain_error(request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status, content={"detail": exc.detail, "code": exc.code}
        )

    @app.exception_handler(IntegrityError)
    async def _integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        # unique 충돌 = 대부분 도메인 충돌(활성 클레임 중복 등). 도메인별 메시지는
        # 각 서비스가 DomainError로 먼저 변환하는 것이 원칙 — 이 핸들러는 최후 방어.
        return JSONResponse(
            status_code=409,
            content={"detail": "이미 존재하거나 충돌하는 요청입니다", "code": "conflict"},
        )

    @app.exception_handler(Exception)
    async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        # Starlette 최외곽 500 handler는 사용자 middleware가 unwind된 뒤 실행된다.
        # scope의 ID를 로그 context에 다시 주입하고 send wrapper를 우회하는 응답
        # 헤더도 직접 설정해 같은 request_id로 연결한다.
        request_id = request.scope.get("request_id") or sanitize_request_id(
            request.headers.get("x-request-id", "")
        )
        token = request_id_var.set(request_id)
        try:
            logger.exception("처리되지 않은 API 오류")
            headers = {**SECURITY_RESPONSE_HEADERS, "X-Request-ID": request_id}
            if request.url.path == "/admin" or request.url.path.startswith(
                ("/admin/", "/auth/admin")
            ):
                headers["Cache-Control"] = "no-store"
            return JSONResponse(
                status_code=500,
                content={"detail": "서버 오류가 발생했습니다", "code": "internal_error"},
                headers=headers,
            )
        finally:
            request_id_var.reset(token)
