"""인증 서비스 — id/pw 로그인(공개 가입 없음), refresh 회전, 소셜 유저 매칭."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from db.models.auth import RefreshToken, User, UserIdentity
from db.models.commerce import AdminSetting
from db.models.tokens import DesignToken
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.config import Settings
from api.errors import DomainError, UnauthorizedError
from api.security import hash_refresh_token, new_refresh_token, password_hasher

LOGIN_FAILED = "이메일 또는 비밀번호가 올바르지 않습니다"
SESSION_EXPIRED = "세션이 만료되었습니다. 다시 로그인해주세요"
SessionKind = Literal["store", "admin"]

# argon2 더미 해시 — 존재하지 않는 계정에서도 verify 시간을 소모해 타이밍 차 제거
_DUMMY_HASH = password_hasher.hash("dummy-password-for-timing")


async def login_with_password(session: AsyncSession, email: str, password: str) -> User:
    user = await session.scalar(select(User).where(User.email == email))
    stored = user.password_hash if user and user.password_hash else _DUMMY_HASH
    ok = await run_in_threadpool(password_hasher.verify, password, stored)
    if user is None or user.password_hash is None or not ok:
        raise UnauthorizedError(LOGIN_FAILED)
    if not user.is_active:
        raise UnauthorizedError("비활성화된 계정입니다")
    return user


def _session_role_allowed(role: str, session_kind: SessionKind) -> bool:
    if session_kind == "store":
        return role == "customer"
    return role in ("admin", "manager")


def _refresh_expiry(settings: Settings, session_kind: SessionKind) -> datetime:
    if session_kind == "admin":
        return datetime.now(UTC) + timedelta(hours=settings.admin_refresh_ttl_hours)
    return datetime.now(UTC) + timedelta(days=settings.refresh_ttl_days)


async def issue_refresh_token(
    session: AsyncSession,
    user_id: uuid.UUID,
    settings: Settings,
    session_kind: SessionKind = "store",
) -> str:
    user = await session.get(User, user_id)
    if user is None or not user.is_active or not _session_role_allowed(user.role, session_kind):
        raise UnauthorizedError(SESSION_EXPIRED)
    raw, token_hash = new_refresh_token()
    session.add(
        RefreshToken(
            user_id=user_id,
            token_hash=token_hash,
            session_kind=session_kind,
            expires_at=_refresh_expiry(settings, session_kind),
        )
    )
    await session.commit()
    return raw


async def rotate_refresh_token(
    session: AsyncSession,
    raw: str,
    settings: Settings,
    session_kind: SessionKind = "store",
) -> tuple[User, str]:
    """원자적 회전 — revoke에 성공한 요청만 새 토큰을 받는다(멀티탭 경합 안전).

    이미 revoke된 토큰의 재사용 = 탈취 신호로 보고 그 유저의 세션 전체를 무효화.
    """
    token_hash = hash_refresh_token(raw)
    row = (
        await session.execute(
            update(RefreshToken)
            .where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.session_kind == session_kind,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > func.now(),
            )
            .values(revoked_at=func.now())
            .returning(RefreshToken.user_id, RefreshToken.expires_at)
        )
    ).first()

    if row is None:
        stale = await session.scalar(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.session_kind == session_kind,
            )
        )
        if stale is not None and stale.revoked_at is not None:
            await revoke_all_refresh_tokens(session, stale.user_id, session_kind)
        await session.commit()
        raise UnauthorizedError(SESSION_EXPIRED)

    user = await session.get(User, row.user_id)
    if user is None or not user.is_active or not _session_role_allowed(user.role, session_kind):
        await revoke_all_refresh_tokens(session, row.user_id, session_kind)
        await session.commit()
        raise UnauthorizedError(SESSION_EXPIRED)

    raw_new, hash_new = new_refresh_token()
    expires_at = (
        row.expires_at if session_kind == "admin" else _refresh_expiry(settings, session_kind)
    )
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_new,
            session_kind=session_kind,
            expires_at=expires_at,
        )
    )
    await session.commit()
    return user, raw_new


async def revoke_refresh_token(
    session: AsyncSession, raw: str, session_kind: SessionKind = "store"
) -> None:
    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == hash_refresh_token(raw),
            RefreshToken.session_kind == session_kind,
        )
        .values(revoked_at=func.now())
    )
    await session.commit()


async def revoke_all_refresh_tokens(
    session: AsyncSession, user_id: uuid.UUID, session_kind: SessionKind
) -> None:
    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.session_kind == session_kind,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=func.now())
    )


async def grant_initial_tokens(session: AsyncSession, user_id: uuid.UUID) -> None:
    """신규 가입 토큰 — typed admin 설정을 그대로 적용한다."""
    value = await session.scalar(
        select(AdminSetting.value).where(AdminSetting.key == "design_token_initial_grant")
    )
    if value is None:
        raise DomainError(
            "신규 사용자 초기 토큰 설정이 없습니다",
            code="missing_configuration",
            status=503,
        )
    clean = value.strip()
    if not clean.isdigit() or not 0 <= int(clean) <= 100_000:
        raise DomainError(
            "신규 사용자 초기 토큰 설정이 올바르지 않습니다",
            code="invalid_configuration",
            status=503,
        )
    amount = int(clean)
    if amount == 0:
        return
    session.add(
        DesignToken(
            user_id=user_id,
            amount=amount,
            type="grant",
            token_class="free",
            description="신규 가입 토큰 지급",
        )
    )


async def ensure_oauth_user(
    session: AsyncSession,
    provider: str,
    provider_user_id: str,
    email: str | None,
    name: str | None,
    *,
    email_verified: bool = False,
) -> User:
    """검증 이메일만 기존 계정에 연결하고 최초 callback unique race는 한 번 재조회한다."""
    for attempt in range(2):
        try:
            return await _ensure_oauth_user(
                session,
                provider,
                provider_user_id,
                email,
                name,
                email_verified=email_verified,
            )
        except IntegrityError:
            await session.rollback()
            if attempt == 1:
                raise
    raise AssertionError("unreachable")


async def _ensure_oauth_user(
    session: AsyncSession,
    provider: str,
    provider_user_id: str,
    email: str | None,
    name: str | None,
    *,
    email_verified: bool,
) -> User:
    identity = await session.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == provider,
            UserIdentity.provider_user_id == provider_user_id,
        )
    )
    if identity is not None:
        user = await session.get(User, identity.user_id)
        if user is None or not user.is_active:
            raise UnauthorizedError("비활성화된 계정입니다")
        if user.role != "customer":
            raise UnauthorizedError("소셜 로그인으로 사용할 수 없는 계정입니다")
        return user

    user = None
    if email and email_verified:
        user = await session.scalar(select(User).where(User.email == email))

    if user is not None and user.role != "customer":
        raise UnauthorizedError("소셜 로그인으로 사용할 수 없는 계정입니다")

    if user is None:
        display_name = name or (email.split("@")[0] if email else "사용자")
        # 미검증 provider 이메일은 계정 식별자로 저장하지 않는다. 동일 문자열을 가진
        # 기존 계정과 분리된 email-less 소셜 계정을 생성해 자동 탈취 연결을 막는다.
        user = User(
            email=email if email_verified else None,
            name=display_name,
            role="customer",
        )
        session.add(user)
        await session.flush()
        await grant_initial_tokens(session, user.id)

    session.add(UserIdentity(user_id=user.id, provider=provider, provider_user_id=provider_user_id))
    await session.commit()
    return user
