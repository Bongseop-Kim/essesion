"""요청 의존성 — 인가 3규칙(ARCHITECTURE §5)의 집행 지점.

① 상품·찜은 공개 조회(OptionalUser) ② 그 외 리소스는 owner-only(ensure_owner)
③ admin/manager는 전체 접근(AdminUser). 정책: 미인증 401 / 남의 것 403 / 없는 것 404.
"""

import hmac
import uuid
from typing import Annotated, Any

from db.models.auth import User
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy import select

from api.config import Settings
from api.db import USER_LOCK, SessionDep, advisory_xact_lock
from api.errors import ForbiddenError, NotFoundError, ServiceUnavailableError, UnauthorizedError
from api.security import decode_access_token

ADMIN_ROLES = ("admin", "manager")
MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

_bearer = HTTPBearer(auto_error=False)
BearerDep = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]


async def _load_user_with_claims(
    token: str,
    session,
    settings: Settings,
    *,
    serialize_mutation: bool = False,
) -> tuple[User, dict[str, Any]]:
    payload = decode_access_token(token, settings)
    user_id = uuid.UUID(payload["sub"])
    if serialize_mutation:
        # 탈퇴도 같은 락을 사용한다. active 확인과 실제 route mutation 사이에
        # soft-delete가 끼어 비활성 사용자 소유 데이터가 다시 생기는 것을 막는다.
        await advisory_xact_lock(session, USER_LOCK.format(user_id=user_id))
    user = await session.scalar(
        select(User).where(User.id == user_id).execution_options(populate_existing=True)
    )
    if user is None or not user.is_active:
        raise UnauthorizedError()
    # 역할 변경 전 발급된 토큰이 현재 DB 역할의 권한을 상속하면 owner-only
    # 리소스까지 우회할 수 있다. 역할 변경은 기존 access token을 즉시 폐기한다.
    if payload.get("role") != user.role:
        raise UnauthorizedError()
    return user, payload


async def get_current_user(
    request: Request,
    creds: BearerDep,
    session: SessionDep,
    settings: SettingsDep,
) -> User:
    if creds is None:
        raise UnauthorizedError()
    user, payload = await _load_user_with_claims(
        creds.credentials,
        session,
        settings,
        serialize_mutation=request.method in MUTATING_METHODS,
    )
    if payload.get("session_kind") != "store":
        raise UnauthorizedError()
    return user


async def get_optional_user(
    creds: BearerDep, session: SessionDep, settings: SettingsDep
) -> User | None:
    if creds is None:
        return None
    user, payload = await _load_user_with_claims(creds.credentials, session, settings)
    if payload.get("session_kind") != "store":
        raise UnauthorizedError()
    return user


async def get_session_user(creds: BearerDep, session: SessionDep, settings: SettingsDep) -> User:
    if creds is None:
        raise UnauthorizedError()
    user, payload = await _load_user_with_claims(creds.credentials, session, settings)
    session_kind = payload.get("session_kind")
    if session_kind == "store" and user.role == "customer":
        return user
    if session_kind == "admin" and user.role in ADMIN_ROLES:
        return user
    raise UnauthorizedError()


async def get_admin_user(creds: BearerDep, session: SessionDep, settings: SettingsDep) -> User:
    if creds is None:
        raise UnauthorizedError()
    user, payload = await _load_user_with_claims(creds.credentials, session, settings)
    if payload.get("session_kind") != "admin" or user.role not in ADMIN_ROLES:
        raise ForbiddenError("관리자 권한이 없습니다.")
    return user


async def get_admin_only(user: Annotated[User, Depends(get_admin_user)]) -> User:
    if user.role != "admin":
        raise ForbiddenError("최고 관리자 권한이 필요합니다.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
SessionUser = Annotated[User, Depends(get_session_user)]
AdminUser = Annotated[User, Depends(get_admin_user)]
AdminOnly = Annotated[User, Depends(get_admin_only)]


def ensure_owner(row: Any, user: User) -> None:
    """owner-only 리소스 접근 규칙 — 없으면 404, 남의 것이면 403(admin은 통과).

    row는 user_id 컬럼을 가진 ORM 행 (Mapped 디스크립터가 Protocol과 안 맞아 Any).
    """
    if row is None:
        raise NotFoundError()
    if user.role not in ADMIN_ROLES and row.user_id != user.id:
        raise ForbiddenError()


_google_request = google_requests.Request()  # Google 인증서 캐시 재사용


def batch_auth_capability_mode(settings: Settings) -> str:
    if settings.batch_oidc_audience and settings.batch_invoker_email:
        return "oidc"
    if (
        settings.env in ("local", "test")
        and not settings.batch_oidc_audience
        and not settings.batch_invoker_email
    ):
        return "shared_secret"
    return "unavailable"


def verify_batch_token(creds: BearerDep, settings: SettingsDep) -> None:
    """Cloud Scheduler → /batch/* 보호.

    batch_oidc_audience 설정 시 Google OIDC id-token 검증 — api는 공개 서비스라
    audience만으론 불충분(임의 SA가 같은 audience 토큰 발급 가능), 발신 SA email까지
    고정한다. 미설정(로컬·테스트)은 batch_token 폴백. sync def — 인증서 fetch가
    블로킹 HTTP라 FastAPI threadpool에서 실행돼야 한다.
    """
    mode = batch_auth_capability_mode(settings)
    if mode == "unavailable":
        raise ServiceUnavailableError(
            "배치 인증 기능을 사용할 수 없습니다.", code="batch_auth_unavailable"
        )
    if creds is None:
        raise UnauthorizedError()
    if mode == "oidc":
        try:
            claims = id_token.verify_oauth2_token(
                creds.credentials, _google_request, settings.batch_oidc_audience
            )
        except (ValueError, GoogleAuthError) as exc:
            raise UnauthorizedError() from exc
        if claims.get("email") != settings.batch_invoker_email:
            raise UnauthorizedError()
        return
    if not hmac.compare_digest(creds.credentials, settings.batch_token):
        raise UnauthorizedError()


BatchAuth = Depends(verify_batch_token)
