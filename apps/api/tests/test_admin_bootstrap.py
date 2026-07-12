from datetime import UTC, datetime, timedelta

import pytest
from api.domains.auth.admin_ops import (
    create_initial_admin,
    reset_admin_password,
    revoke_admin_sessions,
)
from api.errors import ConflictError, DomainError
from api.security import new_refresh_token, password_hasher
from db.models.auth import RefreshToken
from sqlalchemy import func, select


async def test_create_initial_admin_is_one_time(db_session):
    admin = await create_initial_admin(
        db_session,
        email=" Initial.Admin@Test.Local ",
        password="initial-password-123",
        name="초기 관리자",
    )
    assert admin.email == "initial.admin@test.local"
    assert admin.role == "admin"
    assert admin.is_active is True
    assert admin.password_hash is not None
    assert password_hasher.verify("initial-password-123", admin.password_hash)

    with pytest.raises(ConflictError) as exc_info:
        await create_initial_admin(
            db_session,
            email="second-admin@test.local",
            password="second-password-123",
            name="두 번째 관리자",
        )
    assert exc_info.value.code == "admin_exists"


async def test_reset_password_and_revoke_only_admin_sessions(db_session):
    admin = await create_initial_admin(
        db_session,
        email="recovery@test.local",
        password="initial-password-123",
        name="복구 관리자",
    )
    for session_kind in ("store", "admin"):
        _, token_hash = new_refresh_token()
        db_session.add(
            RefreshToken(
                user_id=admin.id,
                token_hash=token_hash,
                session_kind=session_kind,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
    await db_session.commit()

    await reset_admin_password(
        db_session,
        email="RECOVERY@test.local",
        password="rotated-password-123",
    )
    await db_session.refresh(admin)
    assert admin.password_hash is not None
    assert password_hasher.verify("rotated-password-123", admin.password_hash)

    active_by_kind = dict(
        (
            await db_session.execute(
                select(RefreshToken.session_kind, func.count())
                .where(RefreshToken.revoked_at.is_(None))
                .group_by(RefreshToken.session_kind)
            )
        ).all()
    )
    assert active_by_kind == {"store": 1}

    _, token_hash = new_refresh_token()
    db_session.add(
        RefreshToken(
            user_id=admin.id,
            token_hash=token_hash,
            session_kind="admin",
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
    )
    await db_session.commit()
    assert admin.email is not None
    await revoke_admin_sessions(db_session, email=admin.email)
    active_by_kind = dict(
        (
            await db_session.execute(
                select(RefreshToken.session_kind, func.count())
                .where(RefreshToken.revoked_at.is_(None))
                .group_by(RefreshToken.session_kind)
            )
        ).all()
    )
    assert active_by_kind == {"store": 1}


async def test_admin_bootstrap_rejects_weak_password(db_session):
    with pytest.raises(DomainError) as exc_info:
        await create_initial_admin(
            db_session,
            email="weak@test.local",
            password="short",
            name="관리자",
        )
    assert exc_info.value.code == "weak_admin_password"
