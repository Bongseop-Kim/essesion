from typing import Literal

from fastapi import APIRouter, Request, Response
from fastapi.responses import RedirectResponse

from api.config import Settings
from api.db import SessionDep
from api.deps import CurrentUser, SettingsDep
from api.domains.auth import phone as phone_service
from api.domains.auth import service
from api.domains.auth.oauth import fetch_profile, get_oauth_client
from api.domains.auth.rate_limit import admin_auth_rate_limit_key
from api.domains.auth.schemas import (
    LoginRequest,
    MeResponse,
    MessageResponse,
    PhoneSendRequest,
    PhoneVerifyRequest,
    TokenResponse,
)
from api.errors import UnauthorizedError
from api.security import create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "refresh_token"
ADMIN_REFRESH_COOKIE = "admin_refresh_token"


def _enforce_admin_auth_rate_limit(request: Request) -> None:
    client_host = request.client.host if request.client is not None else None
    request.app.state.admin_auth_rate_limiter.check(
        admin_auth_rate_limit_key(request.url.path, client_host)
    )


def _set_refresh_cookie(response: Response, raw: str, settings: Settings) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        raw,
        max_age=settings.refresh_ttl_days * 86400,
        httponly=True,
        secure=settings.env != "local",
        samesite="lax",
        path="/auth",  # refresh·logout에만 전송
    )


def _set_admin_refresh_cookie(response: Response, raw: str, settings: Settings) -> None:
    response.set_cookie(
        ADMIN_REFRESH_COOKIE,
        raw,
        max_age=settings.admin_refresh_ttl_hours * 3600,
        httponly=True,
        secure=settings.env != "local",
        samesite="lax",
        path="/auth/admin",
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest, response: Response, session: SessionDep, settings: SettingsDep
) -> TokenResponse:
    """id/pw 로그인 — 테스트·운영 점검용. 공개 회원가입 없음(계정은 시드/관리자 생성)."""
    user = await service.login_with_password(session, body.email, body.password)
    if user.role != "customer":
        raise UnauthorizedError(service.LOGIN_FAILED)
    raw = await service.issue_refresh_token(session, user.id, settings)
    _set_refresh_cookie(response, raw, settings)
    return TokenResponse(
        access_token=create_access_token(user.id, user.role, settings, session_kind="store")
    )


@router.post("/admin/login", response_model=TokenResponse)
async def admin_login(
    body: LoginRequest,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
) -> TokenResponse:
    _enforce_admin_auth_rate_limit(request)
    user = await service.login_with_password(session, body.email, body.password)
    if user.role not in ("admin", "manager"):
        raise UnauthorizedError(service.LOGIN_FAILED)
    raw = await service.issue_refresh_token(session, user.id, settings, "admin")
    _set_admin_refresh_cookie(response, raw, settings)
    return TokenResponse(
        access_token=create_access_token(user.id, user.role, settings, session_kind="admin")
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(
    request: Request, response: Response, session: SessionDep, settings: SettingsDep
) -> TokenResponse:
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise UnauthorizedError()
    user, new_raw = await service.rotate_refresh_token(session, raw, settings)
    _set_refresh_cookie(response, new_raw, settings)
    return TokenResponse(
        access_token=create_access_token(user.id, user.role, settings, session_kind="store")
    )


@router.post("/admin/refresh", response_model=TokenResponse)
async def admin_refresh_tokens(
    request: Request, response: Response, session: SessionDep, settings: SettingsDep
) -> TokenResponse:
    _enforce_admin_auth_rate_limit(request)
    raw = request.cookies.get(ADMIN_REFRESH_COOKIE)
    if not raw:
        raise UnauthorizedError()
    user, new_raw = await service.rotate_refresh_token(session, raw, settings, "admin")
    _set_admin_refresh_cookie(response, new_raw, settings)
    return TokenResponse(
        access_token=create_access_token(user.id, user.role, settings, session_kind="admin")
    )


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, session: SessionDep) -> None:
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        await service.revoke_refresh_token(session, raw)
    response.delete_cookie(REFRESH_COOKIE, path="/auth")


@router.post("/admin/logout", status_code=204)
async def admin_logout(request: Request, response: Response, session: SessionDep) -> None:
    raw = request.cookies.get(ADMIN_REFRESH_COOKIE)
    if raw:
        await service.revoke_refresh_token(session, raw, "admin")
    response.delete_cookie(ADMIN_REFRESH_COOKIE, path="/auth/admin")


@router.get("/me", response_model=MeResponse)
async def get_me(user: CurrentUser) -> MeResponse:
    return MeResponse.model_validate(user)


@router.get("/{provider}/login", include_in_schema=False)
async def oauth_login(provider: Literal["google", "kakao"], request: Request):
    client = get_oauth_client(request, provider)
    redirect_uri = str(request.url_for("oauth_callback", provider=provider))
    return await client.authorize_redirect(request, redirect_uri)


@router.get("/{provider}/callback", include_in_schema=False)
async def oauth_callback(
    provider: Literal["google", "kakao"],
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
) -> RedirectResponse:
    client = get_oauth_client(request, provider)
    provider_user_id, email, name = await fetch_profile(client, provider, request)
    user = await service.ensure_oauth_user(session, provider, provider_user_id, email, name)
    raw = await service.issue_refresh_token(session, user.id, settings)
    response = RedirectResponse(f"{settings.frontend_origin}/auth/callback")
    _set_refresh_cookie(response, raw, settings)
    return response


@router.post("/phone/send", response_model=MessageResponse, status_code=202)
async def send_phone_verification(
    body: PhoneSendRequest, user: CurrentUser, session: SessionDep, request: Request
) -> MessageResponse:
    await phone_service.send_verification(session, user, body.phone, request.app.state.solapi)
    return MessageResponse(message="인증번호가 발송되었습니다")


@router.post("/phone/verify", response_model=MessageResponse)
async def verify_phone(
    body: PhoneVerifyRequest, user: CurrentUser, session: SessionDep
) -> MessageResponse:
    await phone_service.verify_code(session, user, body.phone, body.code)
    return MessageResponse(message="전화번호 인증이 완료되었습니다")
