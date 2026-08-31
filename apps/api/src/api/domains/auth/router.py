import logging
import uuid
from typing import Literal

from fastapi import APIRouter, Request, Response
from fastapi.responses import RedirectResponse

from api.config import Settings
from api.db import SessionDep
from api.deps import CurrentUser, SessionUser, SettingsDep
from api.domains.auth import phone as phone_service
from api.domains.auth import service
from api.domains.auth.oauth import fetch_profile, get_oauth_client
from api.domains.auth.rate_limit import client_rate_limit_key, request_client_ip
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

logger = logging.getLogger(__name__)

REFRESH_COOKIE = "essesion_store_refresh"
ADMIN_REFRESH_COOKIE = "admin_refresh_token"


def _enforce_admin_auth_rate_limit(request: Request) -> None:
    request.app.state.admin_auth_rate_limiter.check(
        client_rate_limit_key(request.url.path, request_client_ip(request))
    )


def _enforce_store_auth_rate_limit(request: Request) -> None:
    request.app.state.store_auth_rate_limiter.check(
        client_rate_limit_key(request.url.path, request_client_ip(request))
    )


def _enforce_phone_verify_rate_limit(request: Request, user_id: uuid.UUID) -> None:
    limiter = request.app.state.phone_verify_rate_limiter
    client_host = request_client_ip(request)
    limiter.check(f"{request.url.path}:user:{user_id}")
    limiter.check(f"{request.url.path}:ip:{client_host or 'unknown'}")


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
    body: LoginRequest,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
) -> TokenResponse:
    """id/pw 로그인 — 테스트·운영 점검용. 공개 회원가입 없음(계정은 시드/관리자 생성)."""
    _enforce_store_auth_rate_limit(request)
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
async def get_me(user: SessionUser) -> MeResponse:
    return MeResponse.model_validate(user)


OAuthProvider = Literal["google", "kakao", "naver", "apple"]


@router.get("/{provider}/login", include_in_schema=False)
async def oauth_login(
    provider: OAuthProvider,
    request: Request,
    settings: SettingsDep,
    auth_type: Literal["autologin"] | None = None,
):
    client = get_oauth_client(request, provider)
    redirect_uri = (
        str(request.url_for("oauth_callback", provider=provider))
        if settings.env in ("local", "test")
        else f"{settings.public_api_origin}/auth/{provider}/callback"
    )
    # 네이버앱 자동로그인(개발가이드 §5.1) — authorize URL에 auth_type=autologin을 붙인다.
    # 네이버 전용 파라미터라 다른 provider에서는 무시한다.
    extra = {"auth_type": auth_type} if provider == "naver" and auth_type else {}
    return await client.authorize_redirect(request, redirect_uri, **extra)


def _oauth_failure_redirect(settings: Settings, provider: str, code: str) -> RedirectResponse:
    """콜백은 브라우저 최상위 내비게이션의 종착지 — 실패해도 JSON을 반환하지 않는다.

    JSON을 반환하면 API 콜백 URL에 응답 본문이 그대로 화면에 노출된다. 실패 사유는
    프론트가 문구를 고를 수 있는 코드로만 넘긴다 (docs/api-spec/domains.md §1).
    """
    return RedirectResponse(
        f"{settings.frontend_origin}/auth/callback?provider={provider}&error={code}",
        status_code=303,
    )


async def _complete_oauth(
    provider: str, request: Request, session, settings: Settings
) -> RedirectResponse:
    stage = "provider"
    try:
        client = get_oauth_client(request, provider)
        profile = await fetch_profile(client, provider, request)
        stage = "account"
        user = await service.ensure_oauth_user(
            session,
            provider,
            profile.provider_user_id,
            profile.email,
            profile.name,
            email_verified=profile.email_verified,
        )
        if profile.payaddress is not None:
            await service.import_naver_payaddress(session, user, profile.payaddress)
        raw = await service.issue_refresh_token(session, user.id, settings)
    except UnauthorizedError:
        # provider 단계 = 동의창 취소·네이버앱 자동로그인 실패(§5.1.5) 등 error 콜백,
        # account 단계 = 비활성·비고객 계정 거부. 둘은 프론트 문구가 달라야 한다.
        return _oauth_failure_redirect(
            settings,
            provider,
            "access_denied" if stage == "provider" else "account_unavailable",
        )
    except Exception:
        logger.exception("oauth 콜백 실패 (provider=%s, stage=%s)", provider, stage)
        return _oauth_failure_redirect(settings, provider, "server_error")
    response = RedirectResponse(
        f"{settings.frontend_origin}/auth/callback?provider={provider}", status_code=303
    )
    _set_refresh_cookie(response, raw, settings)
    return response


@router.get("/{provider}/callback", include_in_schema=False)
async def oauth_callback(
    provider: OAuthProvider,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
) -> RedirectResponse:
    return await _complete_oauth(provider, request, session, settings)


# Apple은 name/email scope 요청 시 response_mode=form_post — 콜백이 POST로 온다.
# POST 본문 파싱에는 python-multipart가 필요하다(urlencoded도 마찬가지).
@router.post("/apple/callback", include_in_schema=False)
async def apple_oauth_callback(
    request: Request, session: SessionDep, settings: SettingsDep
) -> RedirectResponse:
    # authlib의 form_post 분기는 GET 분기와 달리 error 파라미터를 보지 않는다 —
    # 동의창 취소(error=user_cancelled_authorize)를 여기서 걸러 토큰 교환 왕복을 막는다.
    form = await request.form()
    if form.get("error"):
        return _oauth_failure_redirect(settings, "apple", "access_denied")
    return await _complete_oauth("apple", request, session, settings)


@router.post("/phone/send", response_model=MessageResponse, status_code=202)
async def send_phone_verification(
    body: PhoneSendRequest,
    user: CurrentUser,
    session: SessionDep,
    request: Request,
    settings: SettingsDep,
) -> MessageResponse:
    await phone_service.send_verification(
        session,
        user,
        body.phone,
        request.app.state.solapi,
        secret=settings.session_secret,
        template_id=settings.solapi_template_phone_code,
    )
    return MessageResponse(message="인증번호가 발송되었습니다")


@router.post("/phone/verify", response_model=MessageResponse)
async def verify_phone(
    body: PhoneVerifyRequest,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
) -> MessageResponse:
    _enforce_phone_verify_rate_limit(request, user.id)
    await phone_service.verify_code(
        session, user, body.phone, body.code, secret=settings.session_secret
    )
    return MessageResponse(message="전화번호 인증이 완료되었습니다")
