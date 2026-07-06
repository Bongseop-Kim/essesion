"""도메인 예외 → {"detail": <한국어 원문>, "code": <slug>} 응답.

detail의 한국어 메시지는 기존 시스템의 프론트 노출 계약 — docs/api-spec/domains.md §11.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError


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
