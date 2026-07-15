"""운영 CLI용 관리자 bootstrap·자격 증명 복구."""

from db.models.auth import User
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.domains.auth.service import revoke_all_refresh_tokens
from api.errors import ConflictError, DomainError, NotFoundError
from api.security import password_hasher

ADMIN_ROLES = ("admin", "manager")
MIN_PASSWORD_LENGTH = 12


def _validate_credentials(email: str, password: str) -> tuple[str, str]:
    normalized_email = email.strip().lower()
    if not normalized_email or "@" not in normalized_email:
        raise DomainError("관리자 이메일이 올바르지 않습니다", code="invalid_admin_email")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise DomainError(
            f"관리자 비밀번호는 {MIN_PASSWORD_LENGTH}자 이상이어야 합니다",
            code="weak_admin_password",
        )
    return normalized_email, password


async def create_initial_admin(
    session: AsyncSession, *, email: str, password: str, name: str
) -> User:
    email, password = _validate_credentials(email, password)
    existing_admin = await session.scalar(select(User.id).where(User.role == "admin").limit(1))
    if existing_admin is not None:
        raise ConflictError("관리자 bootstrap이 이미 완료되었습니다", code="admin_exists")
    if await session.scalar(select(User.id).where(User.email == email)) is not None:
        raise ConflictError("같은 이메일의 계정이 이미 존재합니다", code="email_exists")

    user = User(
        email=email,
        name=name.strip() or "관리자",
        role="admin",
        is_active=True,
        password_hash=await run_in_threadpool(password_hasher.hash, password),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def reset_admin_password(session: AsyncSession, *, email: str, password: str) -> User:
    email, password = _validate_credentials(email, password)
    user = await session.scalar(
        select(User).where(User.email == email, User.role.in_(ADMIN_ROLES)).with_for_update()
    )
    if user is None:
        raise NotFoundError("관리자 계정을 찾을 수 없습니다")
    user.password_hash = await run_in_threadpool(password_hasher.hash, password)
    await revoke_all_refresh_tokens(session, user.id, "admin")
    await session.commit()
    return user


async def revoke_admin_sessions(session: AsyncSession, *, email: str) -> User:
    normalized_email = email.strip().lower()
    user = await session.scalar(
        select(User)
        .where(User.email == normalized_email, User.role.in_(ADMIN_ROLES))
        .with_for_update()
    )
    if user is None:
        raise NotFoundError("관리자 계정을 찾을 수 없습니다")
    await revoke_all_refresh_tokens(session, user.id, "admin")
    await session.commit()
    return user
