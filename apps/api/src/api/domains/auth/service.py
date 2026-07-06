"""인증 서비스 — id/pw 로그인(공개 가입 없음), refresh 회전, 소셜 유저 매칭."""

import uuid
from datetime import UTC, datetime, timedelta

from db.models.auth import RefreshToken, User, UserIdentity
from db.models.commerce import AdminSetting
from db.models.tokens import DesignToken
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.config import Settings
from api.errors import UnauthorizedError
from api.security import hash_refresh_token, new_refresh_token, password_hasher

LOGIN_FAILED = "이메일 또는 비밀번호가 올바르지 않습니다"
SESSION_EXPIRED = "세션이 만료되었습니다. 다시 로그인해주세요"

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


def _refresh_expiry(settings: Settings) -> datetime:
    return datetime.now(UTC) + timedelta(days=settings.refresh_ttl_days)


async def issue_refresh_token(
    session: AsyncSession, user_id: uuid.UUID, settings: Settings
) -> str:
    raw, token_hash = new_refresh_token()
    session.add(
        RefreshToken(user_id=user_id, token_hash=token_hash, expires_at=_refresh_expiry(settings))
    )
    await session.commit()
    return raw


async def rotate_refresh_token(
    session: AsyncSession, raw: str, settings: Settings
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
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > func.now(),
            )
            .values(revoked_at=func.now())
            .returning(RefreshToken.user_id)
        )
    ).first()

    if row is None:
        stale = await session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        if stale is not None and stale.revoked_at is not None:
            await revoke_all_refresh_tokens(session, stale.user_id)
        await session.commit()
        raise UnauthorizedError(SESSION_EXPIRED)

    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        await session.commit()
        raise UnauthorizedError(SESSION_EXPIRED)

    raw_new, hash_new = new_refresh_token()
    session.add(
        RefreshToken(user_id=user.id, token_hash=hash_new, expires_at=_refresh_expiry(settings))
    )
    await session.commit()
    return user, raw_new


async def revoke_refresh_token(session: AsyncSession, raw: str) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hash_refresh_token(raw))
        .values(revoked_at=func.now())
    )
    await session.commit()


async def revoke_all_refresh_tokens(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )


async def grant_initial_tokens(session: AsyncSession, user_id: uuid.UUID) -> None:
    """신규 가입 토큰 — admin_settings design_token_initial_grant(기본 30), free·무기한."""
    value = await session.scalar(
        select(AdminSetting.value).where(AdminSetting.key == "design_token_initial_grant")
    )
    amount = int(value) if value and value.isdigit() and int(value) >= 1 else 30
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
) -> User:
    """identity 조회 → (없으면) 이메일 best-effort 매칭 → (없으면) 신규 생성 + 초기 토큰."""
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
        return user

    user = None
    if email:
        user = await session.scalar(select(User).where(User.email == email))

    if user is None:
        display_name = name or (email.split("@")[0] if email else "사용자")
        user = User(email=email, name=display_name, role="customer")
        session.add(user)
        await session.flush()
        await grant_initial_tokens(session, user.id)

    session.add(
        UserIdentity(user_id=user.id, provider=provider, provider_user_id=provider_user_id)
    )
    await session.commit()
    return user
