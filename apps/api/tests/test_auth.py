import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from api.config import Settings
from api.domains.auth.rate_limit import AuthRateLimiter
from api.domains.auth.service import ensure_oauth_user
from api.errors import DomainError, UnauthorizedError
from api.security import decode_access_token, hash_refresh_token, new_refresh_token
from db.models.auth import PhoneVerification, RefreshToken, UserIdentity
from db.models.tokens import DesignToken
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from .factories import auth_headers, make_order, make_user, seed_setting

pytestmark = pytest.mark.anyio if False else []  # asyncio_mode=auto


def _legacy_access_token(user_id: uuid.UUID, role: str, settings: Settings) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user_id),
            "role": role,
            "iat": now,
            "exp": now + timedelta(minutes=settings.access_ttl_minutes),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


async def test_login_and_me(client, db_session, settings):
    await make_user(db_session, email="a@test.local", password="pw-1234", name="김테스트")
    res = await client.post("/auth/login", json={"email": "a@test.local", "password": "pw-1234"})
    assert res.status_code == 200
    access = res.json()["access_token"]
    assert decode_access_token(access, settings)["session_kind"] == "store"
    assert "refresh_token" in res.cookies

    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200
    assert me.json()["name"] == "김테스트"


async def test_login_wrong_password(client, db_session):
    await make_user(db_session, email="b@test.local", password="correct")
    res = await client.post("/auth/login", json={"email": "b@test.local", "password": "wrong"})
    assert res.status_code == 401
    assert res.json()["detail"] == "이메일 또는 비밀번호가 올바르지 않습니다"


async def test_login_unknown_email(client):
    res = await client.post("/auth/login", json={"email": "no@test.local", "password": "x"})
    assert res.status_code == 401


async def test_login_social_only_account_rejected(client, db_session):
    await make_user(db_session, email="social@test.local", password=None)
    res = await client.post("/auth/login", json={"email": "social@test.local", "password": "x"})
    assert res.status_code == 401


@pytest.mark.parametrize("role", ["admin", "manager"])
async def test_store_login_rejects_privileged_accounts(client, db_session, role):
    await make_user(
        db_session,
        email=f"{role}@test.local",
        password="pw",
        role=role,
    )
    res = await client.post("/auth/login", json={"email": f"{role}@test.local", "password": "pw"})
    assert res.status_code == 401
    assert "refresh_token" not in res.cookies


@pytest.mark.parametrize("role", ["admin", "manager"])
async def test_admin_login_uses_separate_cookie(client, db_session, settings, role):
    user = await make_user(
        db_session,
        email=f"admin-login-{role}@test.local",
        password="pw",
        role=role,
    )
    res = await client.post(
        "/auth/admin/login",
        json={"email": user.email, "password": "pw"},
    )
    assert res.status_code == 200
    assert decode_access_token(res.json()["access_token"], settings)["session_kind"] == "admin"
    assert "admin_refresh_token" in res.cookies
    assert "refresh_token" not in res.cookies
    assert res.headers["cache-control"] == "no-store"

    token = await db_session.scalar(select(RefreshToken).where(RefreshToken.user_id == user.id))
    assert token.session_kind == "admin"


async def test_admin_login_rejects_customer(client, db_session):
    user = await make_user(db_session, email="not-admin@test.local", password="pw")
    res = await client.post(
        "/auth/admin/login",
        json={"email": user.email, "password": "pw"},
    )
    assert res.status_code == 401
    assert "admin_refresh_token" not in res.cookies


async def test_me_requires_auth(client):
    assert (await client.get("/auth/me")).status_code == 401


async def test_refresh_rotation_and_reuse_detection(client, db_session, settings):
    await make_user(db_session, email="r@test.local", password="pw")
    login = await client.post("/auth/login", json={"email": "r@test.local", "password": "pw"})
    first_refresh = login.cookies["refresh_token"]

    # 회전 — 새 access + 새 refresh
    client.cookies.clear()
    client.cookies.set("refresh_token", first_refresh, path="/auth")
    rotated = await client.post("/auth/refresh")
    assert rotated.status_code == 200
    assert decode_access_token(rotated.json()["access_token"], settings)["session_kind"] == "store"
    second_refresh = rotated.cookies["refresh_token"]
    assert second_refresh != first_refresh

    # 구 토큰 재사용 = 탈취 신호 → 401 + 유저 세션 전체 무효화
    client.cookies.clear()
    client.cookies.set("refresh_token", first_refresh, path="/auth")
    assert (await client.post("/auth/refresh")).status_code == 401

    client.cookies.clear()
    client.cookies.set("refresh_token", second_refresh, path="/auth")
    assert (await client.post("/auth/refresh")).status_code == 401

    active = await db_session.scalar(
        select(func.count()).select_from(RefreshToken).where(RefreshToken.revoked_at.is_(None))
    )
    assert active == 0


async def test_admin_refresh_replay_revokes_only_admin_sessions(client, db_session, settings):
    admin = await make_user(
        db_session,
        email="session-scope@test.local",
        password="pw",
        role="admin",
    )
    store_raw, store_hash = new_refresh_token()
    db_session.add(
        RefreshToken(
            user_id=admin.id,
            token_hash=store_hash,
            session_kind="store",
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
    )
    await db_session.commit()

    login = await client.post("/auth/admin/login", json={"email": admin.email, "password": "pw"})
    first_admin_refresh = login.cookies["admin_refresh_token"]

    client.cookies.clear()
    client.cookies.set("admin_refresh_token", first_admin_refresh, path="/auth/admin")
    rotated = await client.post("/auth/admin/refresh")
    assert rotated.status_code == 200
    assert decode_access_token(rotated.json()["access_token"], settings)["session_kind"] == "admin"

    client.cookies.clear()
    client.cookies.set("admin_refresh_token", first_admin_refresh, path="/auth/admin")
    assert (await client.post("/auth/admin/refresh")).status_code == 401

    active_store = await db_session.scalar(
        select(func.count())
        .select_from(RefreshToken)
        .where(
            RefreshToken.user_id == admin.id,
            RefreshToken.session_kind == "store",
            RefreshToken.revoked_at.is_(None),
        )
    )
    active_admin = await db_session.scalar(
        select(func.count())
        .select_from(RefreshToken)
        .where(
            RefreshToken.user_id == admin.id,
            RefreshToken.session_kind == "admin",
            RefreshToken.revoked_at.is_(None),
        )
    )
    assert active_store == 1
    assert active_admin == 0

    # admin cookie 경로에 store token을 넣어도 다른 kind 세션을 폐기하지 않는다.
    client.cookies.clear()
    client.cookies.set("admin_refresh_token", store_raw, path="/auth/admin")
    assert (await client.post("/auth/admin/refresh")).status_code == 401
    remaining_store = await db_session.scalar(
        select(func.count())
        .select_from(RefreshToken)
        .where(
            RefreshToken.token_hash == hash_refresh_token(store_raw),
            RefreshToken.revoked_at.is_(None),
        )
    )
    assert remaining_store == 1


async def test_store_refresh_rejects_legacy_privileged_session(client, db_session):
    admin = await make_user(db_session, role="admin")
    raw, token_hash = new_refresh_token()
    db_session.add(
        RefreshToken(
            user_id=admin.id,
            token_hash=token_hash,
            session_kind="store",
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
    )
    await db_session.commit()

    client.cookies.set("refresh_token", raw, path="/auth")
    assert (await client.post("/auth/refresh")).status_code == 401


async def test_admin_refresh_keeps_absolute_expiry(client, db_session):
    admin = await make_user(
        db_session,
        email="absolute-expiry@test.local",
        password="pw",
        role="admin",
    )
    login = await client.post("/auth/admin/login", json={"email": admin.email, "password": "pw"})
    raw = login.cookies["admin_refresh_token"]
    client.cookies.clear()
    client.cookies.set("admin_refresh_token", raw, path="/auth/admin")
    assert (await client.post("/auth/admin/refresh")).status_code == 200

    expiries = (
        await db_session.scalars(
            select(RefreshToken.expires_at)
            .where(
                RefreshToken.user_id == admin.id,
                RefreshToken.session_kind == "admin",
            )
            .order_by(RefreshToken.created_at)
        )
    ).all()
    assert len(expiries) == 2
    assert expiries[0] == expiries[1]


async def test_store_and_admin_cookies_coexist_and_logout_independently(client, db_session):
    customer = await make_user(
        db_session,
        email="cookie-customer@test.local",
        password="pw",
    )
    admin = await make_user(
        db_session,
        email="cookie-admin@test.local",
        password="pw",
        role="admin",
    )
    store_login = await client.post("/auth/login", json={"email": customer.email, "password": "pw"})
    admin_login = await client.post(
        "/auth/admin/login", json={"email": admin.email, "password": "pw"}
    )
    assert "refresh_token" in store_login.cookies
    assert "admin_refresh_token" in admin_login.cookies

    logout = await client.post("/auth/admin/logout")
    assert logout.status_code == 204
    assert (await client.post("/auth/refresh")).status_code == 200


async def test_logout_revokes_refresh(client, db_session):
    await make_user(db_session, email="o@test.local", password="pw")
    login = await client.post("/auth/login", json={"email": "o@test.local", "password": "pw"})
    raw = login.cookies["refresh_token"]

    client.cookies.set("refresh_token", raw, path="/auth")
    assert (await client.post("/auth/logout")).status_code == 204

    client.cookies.clear()
    client.cookies.set("refresh_token", raw, path="/auth")
    assert (await client.post("/auth/refresh")).status_code == 401


async def test_phone_send_and_verify(app, client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)

    res = await client.post("/auth/phone/send", json={"phone": "010-1234-5678"}, headers=headers)
    assert res.status_code == 202
    sent = app.state.solapi.sent
    assert len(sent) == 1 and "인증번호는 [" in sent[0]["text"]

    code = (
        await db_session.scalar(
            select(PhoneVerification).order_by(PhoneVerification.created_at.desc())
        )
    ).code

    wrong = await client.post(
        "/auth/phone/verify", json={"phone": "01012345678", "code": "000000"}, headers=headers
    )
    if code != "000000":
        assert wrong.status_code == 400
        assert wrong.json()["detail"] == "인증번호가 일치하지 않습니다"

    ok = await client.post(
        "/auth/phone/verify", json={"phone": "01012345678", "code": code}, headers=headers
    )
    assert ok.status_code == 200

    me = await client.get("/auth/me", headers=headers)
    assert me.json()["phone"] == "01012345678"
    assert me.json()["phone_verified"] is True


async def test_phone_send_resend_limit(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    first = await client.post("/auth/phone/send", json={"phone": "01011112222"}, headers=headers)
    assert first.status_code == 202
    second = await client.post("/auth/phone/send", json={"phone": "01011112222"}, headers=headers)
    assert second.status_code == 429
    assert second.json()["detail"] == "1분 후 재전송 가능합니다"


async def test_phone_invalid_format(client, db_session, settings):
    user = await make_user(db_session)
    res = await client.post(
        "/auth/phone/send", json={"phone": "02-123-4567"}, headers=auth_headers(user, settings)
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "유효하지 않은 휴대폰 번호입니다"


async def test_phone_expired_code(client, db_session, settings):
    user = await make_user(db_session)
    db_session.add(
        PhoneVerification(
            user_id=user.id,
            phone="01099998888",
            code="123456",
            expires_at=datetime.now(UTC) - timedelta(minutes=1),
        )
    )
    await db_session.commit()
    res = await client.post(
        "/auth/phone/verify",
        json={"phone": "01099998888", "code": "123456"},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "인증번호가 만료되었습니다"


async def test_oauth_user_creation_grants_initial_tokens(db_session):
    await seed_setting(db_session, "design_token_initial_grant", "30")
    user = await ensure_oauth_user(db_session, "kakao", "kakao-1", None, "카카오유저")
    assert user.email is None and user.name == "카카오유저"

    balance = await db_session.scalar(
        select(func.sum(DesignToken.amount)).where(DesignToken.user_id == user.id)
    )
    assert balance == 30

    # 같은 identity 재로그인 — 같은 유저, 토큰 추가 지급 없음
    again = await ensure_oauth_user(db_session, "kakao", "kakao-1", None, "카카오유저")
    assert again.id == user.id
    count = await db_session.scalar(
        select(func.count()).select_from(UserIdentity).where(UserIdentity.user_id == user.id)
    )
    assert count == 1


async def test_oauth_user_creation_rejects_missing_initial_token_setting(db_session):
    with pytest.raises(DomainError) as exc_info:
        await ensure_oauth_user(db_session, "kakao", "missing-grant", None, "카카오유저")

    assert exc_info.value.status == 503
    assert exc_info.value.code == "missing_configuration"
    await db_session.rollback()
    assert await db_session.scalar(select(func.count()).select_from(UserIdentity)) == 0


async def test_oauth_user_creation_rejects_invalid_initial_token_setting(db_session):
    await seed_setting(db_session, "design_token_initial_grant", "invalid")

    with pytest.raises(DomainError) as exc_info:
        await ensure_oauth_user(db_session, "kakao", "invalid-grant", None, "카카오유저")

    assert exc_info.value.status == 503
    assert exc_info.value.code == "invalid_configuration"
    await db_session.rollback()
    assert await db_session.scalar(select(func.count()).select_from(UserIdentity)) == 0


async def test_oauth_user_creation_allows_zero_initial_tokens_without_ledger_row(db_session):
    await seed_setting(db_session, "design_token_initial_grant", "0")

    user = await ensure_oauth_user(db_session, "kakao", "zero-grant", None, "카카오유저")

    assert (
        await db_session.scalar(
            select(func.count()).select_from(DesignToken).where(DesignToken.user_id == user.id)
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count()).select_from(UserIdentity).where(UserIdentity.user_id == user.id)
        )
        == 1
    )


async def test_oauth_links_existing_user_by_email(db_session):
    existing = await make_user(db_session, email="link@test.local")
    linked = await ensure_oauth_user(db_session, "google", "g-123", "link@test.local", "구글이름")
    assert linked.id == existing.id
    identity = await db_session.scalar(
        select(UserIdentity).where(UserIdentity.provider == "google")
    )
    assert identity.user_id == existing.id


@pytest.mark.parametrize("role", ["admin", "manager"])
async def test_oauth_refuses_privileged_email_link(db_session, role):
    privileged = await make_user(
        db_session,
        email=f"oauth-{role}@test.local",
        role=role,
    )
    with pytest.raises(UnauthorizedError) as exc_info:
        await ensure_oauth_user(
            db_session,
            "google",
            f"oauth-{role}",
            privileged.email,
            "OAuth 이름",
        )
    assert "소셜 로그인으로 사용할 수 없는 계정" in str(exc_info.value)
    identity = await db_session.scalar(
        select(UserIdentity).where(UserIdentity.provider_user_id == f"oauth-{role}")
    )
    assert identity is None


async def test_oauth_refuses_existing_privileged_identity(db_session):
    privileged = await make_user(db_session, role="admin")
    db_session.add(
        UserIdentity(
            user_id=privileged.id,
            provider="google",
            provider_user_id="privileged-identity",
        )
    )
    await db_session.commit()

    with pytest.raises(UnauthorizedError):
        await ensure_oauth_user(
            db_session,
            "google",
            "privileged-identity",
            privileged.email,
            "OAuth 이름",
        )


async def test_store_access_token_cannot_gain_admin_access_after_role_promotion(
    client, db_session, settings
):
    customer = await make_user(
        db_session,
        email="promoted-customer@test.local",
        password="pw",
    )
    login = await client.post(
        "/auth/login",
        json={"email": customer.email, "password": "pw"},
    )
    assert login.status_code == 200

    customer.role = "admin"
    await db_session.commit()

    denied = await client.get(
        "/admin/capabilities",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert denied.status_code == 401


async def test_stale_store_token_cannot_use_promoted_role_to_bypass_owner_scope(client, db_session):
    owner = await make_user(db_session, email="stale-role-owner@test.local")
    attacker = await make_user(
        db_session,
        email="stale-role-attacker@test.local",
        password="pw",
    )
    order = await make_order(db_session, owner)
    login = await client.post(
        "/auth/login",
        json={"email": attacker.email, "password": "pw"},
    )
    assert login.status_code == 200

    attacker.role = "admin"
    await db_session.commit()

    denied = await client.get(
        f"/orders/{order.id}",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert denied.status_code == 401


async def test_manager_access_token_cannot_gain_admin_only_access_after_role_promotion(
    client, db_session
):
    manager = await make_user(
        db_session,
        email="promoted-manager@test.local",
        password="pw",
        role="manager",
    )
    login = await client.post(
        "/auth/admin/login",
        json={"email": manager.email, "password": "pw"},
    )
    assert login.status_code == 200

    manager.role = "admin"
    await db_session.commit()

    denied = await client.post(
        "/admin/tokens/manage",
        json={
            "operation_id": str(uuid.uuid4()),
            "user_id": str(manager.id),
            "amount": 1,
            "description": "승격 전 토큰 거부 확인",
        },
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert denied.status_code == 401


async def test_admin_access_token_allows_admin_endpoint(client, db_session):
    admin = await make_user(
        db_session,
        email="access-kind-admin@test.local",
        password="pw",
        role="admin",
    )
    login = await client.post(
        "/auth/admin/login",
        json={"email": admin.email, "password": "pw"},
    )
    assert login.status_code == 200

    allowed = await client.get(
        "/admin/capabilities",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert allowed.status_code == 200


async def test_legacy_access_token_is_store_compatible_but_cannot_access_admin(
    client, db_session, settings
):
    customer = await make_user(db_session)
    customer_token = _legacy_access_token(customer.id, customer.role, settings)
    assert (
        await client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {customer_token}"},
        )
    ).status_code == 200

    admin = await make_user(db_session, role="admin")
    admin_token = _legacy_access_token(admin.id, admin.role, settings)
    denied = await client.get(
        "/admin/capabilities",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert denied.status_code == 403


async def test_admin_origin_boundary_and_no_store(app, client, db_session, settings):
    admin = await make_user(db_session, role="admin")
    allowed = await client.get("/admin/capabilities", headers=auth_headers(admin, settings))
    assert allowed.status_code == 200
    assert allowed.headers["cache-control"] == "no-store"
    assert allowed.json() == app.state.capabilities

    store_origin = await client.get(
        "/admin/capabilities",
        headers={**auth_headers(admin, settings), "Origin": settings.frontend_origin},
    )
    assert store_origin.status_code == 403
    assert store_origin.headers["cache-control"] == "no-store"

    admin_auth_from_store = await client.post(
        "/auth/admin/login",
        json={"email": "nobody@test.local", "password": "wrong"},
        headers={"Origin": settings.frontend_origin},
    )
    assert admin_auth_from_store.status_code == 403
    assert admin_auth_from_store.headers["cache-control"] == "no-store"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as no_origin:
        missing = await no_origin.get("/admin/capabilities", headers=auth_headers(admin, settings))
    assert missing.status_code == 403
    assert missing.headers["cache-control"] == "no-store"


async def test_manager_can_read_but_cannot_run_admin_only_mutation(client, db_session, settings):
    manager = await make_user(db_session, role="manager")
    headers = auth_headers(manager, settings)

    assert (await client.get("/admin/capabilities", headers=headers)).status_code == 200
    denied = await client.post(
        "/admin/tokens/manage",
        json={
            "operation_id": str(uuid.uuid4()),
            "user_id": str(manager.id),
            "amount": 1,
            "description": "권한 확인",
        },
        headers=headers,
    )
    assert denied.status_code == 403
    assert denied.json()["detail"] == "최고 관리자 권한이 필요합니다."


async def test_admin_login_and_refresh_rate_limits_are_separate(app, client):
    app.state.admin_auth_rate_limiter = AuthRateLimiter(attempts=2, window_seconds=60, max_keys=10)
    for _ in range(2):
        login = await client.post(
            "/auth/admin/login",
            json={"email": "missing@test.local", "password": "wrong"},
        )
        assert login.status_code == 401
    limited_login = await client.post(
        "/auth/admin/login",
        json={"email": "missing@test.local", "password": "wrong"},
    )
    assert limited_login.status_code == 429
    assert limited_login.headers["cache-control"] == "no-store"

    assert (await client.post("/auth/admin/refresh")).status_code == 401
    assert (await client.post("/auth/admin/refresh")).status_code == 401
    limited_refresh = await client.post("/auth/admin/refresh")
    assert limited_refresh.status_code == 429
