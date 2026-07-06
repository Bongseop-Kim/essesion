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
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy import select

from api.config import Settings
from api.db import SessionDep
from api.errors import ForbiddenError, NotFoundError, UnauthorizedError
from api.security import decode_access_token

ADMIN_ROLES = ("admin", "manager")

_bearer = HTTPBearer(auto_error=False)
BearerDep = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]


async def _load_user(token: str, session, settings: Settings) -> User:
    payload = decode_access_token(token, settings)
    user = await session.get(User, uuid.UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise UnauthorizedError()
    return user


async def get_current_user(creds: BearerDep, session: SessionDep, settings: SettingsDep) -> User:
    if creds is None:
        raise UnauthorizedError()
    return await _load_user(creds.credentials, session, settings)


async def get_optional_user(
    creds: BearerDep, session: SessionDep, settings: SettingsDep
) -> User | None:
    if creds is None:
        return None
    return await _load_user(creds.credentials, session, settings)


async def get_admin_user(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role not in ADMIN_ROLES:
        raise ForbiddenError("관리자 권한이 없습니다.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
AdminUser = Annotated[User, Depends(get_admin_user)]


def ensure_owner(row: Any, user: User) -> None:
    """owner-only 리소스 접근 규칙 — 없으면 404, 남의 것이면 403(admin은 통과).

    row는 user_id 컬럼을 가진 ORM 행 (Mapped 디스크립터가 Protocol과 안 맞아 Any).
    """
    if row is None:
        raise NotFoundError()
    if user.role not in ADMIN_ROLES and row.user_id != user.id:
        raise ForbiddenError()


_google_request = google_requests.Request()  # Google 인증서 캐시 재사용


def verify_batch_token(creds: BearerDep, settings: SettingsDep) -> None:
    """Cloud Scheduler → /batch/* 보호.

    batch_oidc_audience 설정 시 Google OIDC id-token 검증 — api는 공개 서비스라
    audience만으론 불충분(임의 SA가 같은 audience 토큰 발급 가능), 발신 SA email까지
    고정한다. 미설정(로컬·테스트)은 batch_token 폴백. sync def — 인증서 fetch가
    블로킹 HTTP라 FastAPI threadpool에서 실행돼야 한다.
    """
    if creds is None:
        raise UnauthorizedError()
    if settings.batch_oidc_audience:
        try:
            claims = id_token.verify_oauth2_token(
                creds.credentials, _google_request, settings.batch_oidc_audience
            )
        except ValueError as exc:
            raise UnauthorizedError() from exc
        if claims.get("email") != settings.batch_invoker_email:
            raise UnauthorizedError()
        return
    if not hmac.compare_digest(creds.credentials, settings.batch_token):
        raise UnauthorizedError()


BatchAuth = Depends(verify_batch_token)


async def get_user_by_id_for_update(session, user_id: uuid.UUID) -> User | None:
    return await session.scalar(select(User).where(User.id == user_id).with_for_update())
