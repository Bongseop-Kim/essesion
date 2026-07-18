"""소셜 OAuth — Google·Apple(OIDC discovery)·Kakao·Naver(수동 등록).

Authlib starlette 통합 — state/nonce는 SessionMiddleware 쿠키에 저장된다.
Apple은 response_mode=form_post(크로스사이트 POST 콜백)라 세션 쿠키가
SameSite=None이어야 한다 (main.py의 SessionMiddleware 설정).
"""

import json
import time
from dataclasses import dataclass

from authlib.integrations.starlette_client import OAuth, OAuthError
from authlib.jose import jwt as jose_jwt
from starlette.requests import Request

from api.config import Settings
from api.errors import DomainError, UnauthorizedError

SUPPORTED_PROVIDERS = ("google", "kakao", "naver", "apple")

# Apple client_secret JWT 수명. 최대 6개월 — Cloud Run 인스턴스 수명보다 훨씬 길어
# 프로세스 기동 시 1회 생성으로 충분하다.
_APPLE_SECRET_TTL_SECONDS = 180 * 86400


@dataclass(frozen=True)
class OAuthProfile:
    provider_user_id: str
    email: str | None
    name: str | None
    email_verified: bool


def _apple_client_secret(settings: Settings) -> str:
    """Apple은 고정 secret 대신 .p8 키로 서명한 ES256 JWT를 client_secret으로 요구한다."""
    now = int(time.time())
    signed = jose_jwt.encode(
        {"alg": "ES256", "kid": settings.apple_key_id},
        {
            "iss": settings.apple_team_id,
            "iat": now,
            "exp": now + _APPLE_SECRET_TTL_SECONDS,
            "aud": "https://appleid.apple.com",
            "sub": settings.apple_client_id,
        },
        settings.apple_private_key.replace("\\n", "\n"),
    )
    return signed.decode("ascii")


def build_oauth(settings: Settings) -> OAuth:
    oauth = OAuth()
    if settings.google_client_id:
        oauth.register(
            name="google",
            client_id=settings.google_client_id,
            client_secret=settings.google_client_secret,
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email"},
        )
    if settings.kakao_client_id:
        oauth.register(
            name="kakao",
            client_id=settings.kakao_client_id,
            client_secret=settings.kakao_client_secret or None,
            authorize_url="https://kauth.kakao.com/oauth/authorize",
            access_token_url="https://kauth.kakao.com/oauth/token",
            api_base_url="https://kapi.kakao.com/",
            client_kwargs={
                "scope": "profile_nickname account_email",
                "token_endpoint_auth_method": "client_secret_post",
            },
        )
    if settings.naver_client_id:
        oauth.register(
            name="naver",
            client_id=settings.naver_client_id,
            client_secret=settings.naver_client_secret,
            authorize_url="https://nid.naver.com/oauth2.0/authorize",
            access_token_url="https://nid.naver.com/oauth2.0/token",
            api_base_url="https://openapi.naver.com/",
            client_kwargs={"token_endpoint_auth_method": "client_secret_post"},
        )
    if (
        settings.apple_client_id
        and settings.apple_team_id
        and settings.apple_key_id
        and settings.apple_private_key
    ):
        oauth.register(
            name="apple",
            client_id=settings.apple_client_id,
            client_secret=_apple_client_secret(settings),
            server_metadata_url="https://appleid.apple.com/.well-known/openid-configuration",
            # name/email scope 요청 시 Apple이 form_post를 강제한다 (POST 콜백).
            authorize_params={"response_mode": "form_post"},
            client_kwargs={
                "scope": "openid name email",
                "token_endpoint_auth_method": "client_secret_post",
            },
        )
    return oauth


def get_oauth_client(request: Request, provider: str):
    if provider not in SUPPORTED_PROVIDERS:
        raise DomainError("지원하지 않는 로그인 방식입니다", code="unsupported_provider")
    client = request.app.state.oauth.create_client(provider)
    if client is None:
        raise DomainError(
            f"{provider} 로그인이 설정되지 않았습니다", code="provider_not_configured", status=503
        )
    return client


def _apple_name_from_form_user(raw_user: object) -> str | None:
    """최초 인가에서만 오는 user 폼 필드(JSON)의 이름 — 한국식 성+이름 결합."""
    if not isinstance(raw_user, str):
        return None
    try:
        parsed = json.loads(raw_user)
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    name_obj = parsed.get("name")
    if not isinstance(name_obj, dict):
        return None
    parts = [name_obj.get("lastName"), name_obj.get("firstName")]
    joined = "".join(part for part in parts if isinstance(part, str) and part)
    return joined or None


async def fetch_profile(client, provider: str, request: Request) -> OAuthProfile:
    """Provider별 검증 claim을 보존한 프로필. 카카오는 이메일 미동의 가능."""
    try:
        token = await client.authorize_access_token(request)
    except OAuthError as exc:
        raise UnauthorizedError("소셜 로그인에 실패했습니다") from exc

    if provider == "google":
        info = token.get("userinfo") or {}
        email = info.get("email") if isinstance(info.get("email"), str) else None
        name = info.get("name") if isinstance(info.get("name"), str) else None
        return OAuthProfile(
            provider_user_id=str(info["sub"]),
            email=email,
            name=name,
            # Google OIDC의 email_verified boolean만 신뢰한다. 문자열 "true"는 거부.
            email_verified=email is not None and info.get("email_verified") is True,
        )

    if provider == "apple":
        info = token.get("userinfo") or {}
        email = info.get("email") if isinstance(info.get("email"), str) else None
        form = await request.form()
        return OAuthProfile(
            provider_user_id=str(info["sub"]),
            email=email,
            name=_apple_name_from_form_user(form.get("user")),
            # Apple은 email_verified를 bool 또는 "true" 문자열로 준다. 둘 다 검증 취급
            # (private relay 포함 Apple이 소유를 보장하는 주소만 내려온다).
            email_verified=email is not None and info.get("email_verified") in (True, "true"),
        )

    if provider == "naver":
        res = await client.get("v1/nid/me", token=token)
        body = res.json()
        info = body.get("response") or {}
        email = info.get("email") if isinstance(info.get("email"), str) else None
        name = info.get("name") if isinstance(info.get("name"), str) else None
        return OAuthProfile(
            provider_user_id=str(info["id"]),
            email=email,
            name=name,
            # 네이버는 검증 플래그가 없다. 본인 계정 주소(@naver.com)만 검증 취급 —
            # 외부 연락처 이메일은 소유 증빙이 없어 자동 링크(계정 탈취 벡터)에서 제외.
            email_verified=email is not None and email.lower().endswith("@naver.com"),
        )

    res = await client.get("v2/user/me", token=token)
    body = res.json()
    account = body.get("kakao_account") or {}
    profile = account.get("profile") or {}
    email = account.get("email") if isinstance(account.get("email"), str) else None
    name = profile.get("nickname") if isinstance(profile.get("nickname"), str) else None
    return OAuthProfile(
        provider_user_id=str(body["id"]),
        email=email,
        name=name,
        # Kakao는 유효성과 검증 여부가 별도다. 둘 다 명시적 true여야 자동 링크 가능.
        email_verified=(
            email is not None
            and account.get("is_email_valid") is True
            and account.get("is_email_verified") is True
        ),
    )
