"""소셜 OAuth — Google(OIDC discovery)·Kakao(수동 등록). Apple·Naver는 준비물 도착 후.

Authlib starlette 통합 — state/nonce는 SessionMiddleware 쿠키에 저장된다.
"""

from dataclasses import dataclass

from authlib.integrations.starlette_client import OAuth, OAuthError
from starlette.requests import Request

from api.config import Settings
from api.errors import DomainError, UnauthorizedError

SUPPORTED_PROVIDERS = ("google", "kakao")


@dataclass(frozen=True)
class OAuthProfile:
    provider_user_id: str
    email: str | None
    name: str | None
    email_verified: bool


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
