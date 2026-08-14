from datetime import UTC, datetime, timedelta

import pytest
from api.config_defaults import ADMIN_SETTINGS, PRICING, apply_config_defaults
from api.domains.admin.configuration import PRICE_CATEGORIES, SETTING_KEYS
from api.domains.auth.admin_ops import (
    create_initial_admin,
    reset_admin_password,
    revoke_admin_sessions,
)
from api.errors import ConflictError, DomainError
from api.security import new_refresh_token, password_hasher
from db.models.auth import RefreshToken
from db.models.commerce import AdminSetting, PricingConstant
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


async def test_seed_config_fills_gaps_without_clobbering_operator_values(db_session):
    """production 경로(overwrite=False)는 빠진 행만 채우고 조정값을 되돌리지 않는다."""
    await apply_config_defaults(db_session, overwrite=False)
    await db_session.flush()

    settings_count = await db_session.scalar(select(func.count()).select_from(AdminSetting))
    pricing_count = await db_session.scalar(select(func.count()).select_from(PricingConstant))
    assert settings_count == len(ADMIN_SETTINGS)
    assert pricing_count == len(PRICING)

    # 운영자가 화면에서 단가를 올리고 플랜 가격을 조정한 상황.
    tuned = await db_session.scalar(
        select(AdminSetting).where(AdminSetting.key == "design_edit_cost")
    )
    tuned.value = "30"
    tuned_price = await db_session.scalar(
        select(PricingConstant).where(PricingConstant.key == "token_plan_pro_price")
    )
    tuned_price.amount = 19000
    await db_session.flush()

    # 재실행은 멱등이어야 하고 조정값을 덮지 않아야 한다.
    await apply_config_defaults(db_session, overwrite=False)
    await db_session.flush()
    await db_session.refresh(tuned)
    await db_session.refresh(tuned_price)
    assert tuned.value == "30"
    assert tuned_price.amount == 19000
    assert await db_session.scalar(select(func.count()).select_from(AdminSetting)) == len(
        ADMIN_SETTINGS
    )

    # 로컬 경로(overwrite=True)는 반대로 기본값으로 되돌린다.
    await apply_config_defaults(db_session, overwrite=True)
    await db_session.flush()
    await db_session.refresh(tuned)
    await db_session.refresh(tuned_price)
    assert tuned.value == ADMIN_SETTINGS["design_edit_cost"]
    assert tuned_price.amount == PRICING["token_plan_pro_price"][0]


async def test_seed_config_covers_every_key_the_admin_screen_requires(db_session):
    """설정 화면이 요구하는 키가 하나라도 빠지면 그 행은 화면에서 만들 수 없다."""
    await apply_config_defaults(db_session, overwrite=False)
    await db_session.flush()

    assert set(SETTING_KEYS) <= set(ADMIN_SETTINGS)
    assert set(PRICE_CATEGORIES) <= set(PRICING)
    for key, category in PRICE_CATEGORIES.items():
        assert PRICING[key][1] == category
