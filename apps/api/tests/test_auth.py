import asyncio
import re
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import cast

import jwt
import pytest
from api.config import Settings
from api.domains.auth import phone as phone_service
from api.domains.auth import service as auth_service
from api.domains.auth.oauth import _apple_client_secret, fetch_profile
from api.domains.auth.rate_limit import AuthRateLimiter
from api.domains.auth.router import REFRESH_COOKIE
from api.domains.auth.service import ensure_oauth_user
from api.errors import DomainError, RateLimitedError, UnauthorizedError
from api.security import decode_access_token, hash_refresh_token, new_refresh_token
from db.models.auth import PhoneVerification, RefreshToken, User, UserIdentity
from db.models.tokens import DesignToken
from httpx import ASGITransport, AsyncClient
from joserfc import jwt as jose_jwt
from joserfc.jwk import ECKey
from sqlalchemy import func, select
from starlette.requests import Request
from starlette.responses import RedirectResponse

from .factories import auth_headers, make_order, make_user, seed_setting


def _access_token_without_session_kind(user_id: uuid.UUID, role: str, settings: Settings) -> str:
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


@pytest.mark.parametrize("provider", ["google", "kakao", "naver", "apple"])
async def test_oauth_login_uses_public_origin_behind_cloud_run_proxy_host(
    app, client, settings, monkeypatch, provider
):
    captured: dict[str, str] = {}

    class FakeOAuthClient:
        async def authorize_redirect(self, request, redirect_uri):
            captured["request_host"] = request.url.hostname or ""
            captured["redirect_uri"] = redirect_uri
            return RedirectResponse("https://provider.example/authorize")

    monkeypatch.setattr(
        "api.domains.auth.router.get_oauth_client",
        lambda _request, _provider: FakeOAuthClient(),
    )
    settings.env = "staging"
    settings.public_api_origin = "https://api.essesion.shop"

    response = await client.get(
        f"https://api-project-hash.a.run.app/auth/{provider}/login",
        follow_redirects=False,
    )

    assert response.status_code == 307
    assert captured == {
        "request_host": "api-project-hash.a.run.app",
        "redirect_uri": f"https://api.essesion.shop/auth/{provider}/callback",
    }


def test_apple_client_secret_is_valid_es256_jwt(settings):
    private_key = ECKey.generate_key("P-256")
    settings.apple_client_id = "com.essesion.web"
    settings.apple_team_id = "TEAM123456"
    settings.apple_key_id = "KEY1234567"
    settings.apple_private_key = private_key.as_pem(private=True).decode("ascii")
    before = int(time.time())

    encoded = _apple_client_secret(settings)

    after = int(time.time())
    public_key = ECKey.import_key(private_key.as_pem(private=False))
    token = jose_jwt.decode(encoded, public_key, algorithms=["ES256"])
    assert token.header == {"typ": "JWT", "alg": "ES256", "kid": "KEY1234567"}
    assert token.claims["iss"] == "TEAM123456"
    assert token.claims["aud"] == "https://appleid.apple.com"
    assert token.claims["sub"] == "com.essesion.web"
    assert before <= token.claims["iat"] <= after
    assert token.claims["exp"] - token.claims["iat"] == 180 * 86400


async def test_login_and_me(client, db_session, settings):
    await make_user(db_session, email="a@test.local", password="pw-1234", name="김테스트")
    res = await client.post("/auth/login", json={"email": "a@test.local", "password": "pw-1234"})
    assert res.status_code == 200
    access = res.json()["access_token"]
    assert decode_access_token(access, settings)["session_kind"] == "store"
    assert REFRESH_COOKIE in res.cookies

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


async def test_login_rejects_oversized_credentials_before_password_verification(
    client, monkeypatch
):
    login_called = False

    async def unexpected_login(*_args, **_kwargs):
        nonlocal login_called
        login_called = True
        raise AssertionError("password verification must not run")

    monkeypatch.setattr(auth_service, "login_with_password", unexpected_login)
    invalid_bodies = (
        {"email": f"{'e' * 311}@test.local", "password": "pw"},
        {"email": "bounded@test.local", "password": "p" * 1025},
    )

    for body in invalid_bodies:
        response = await client.post("/auth/login", json=body)
        assert response.status_code == 422

    assert login_called is False


async def test_store_login_rate_limit_blocks_repeated_password_checks(app, client):
    app.state.store_auth_rate_limiter = AuthRateLimiter(
        attempts=2,
        window_seconds=60,
        max_keys=10,
        detail="로그인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    )
    body = {"email": "missing@test.local", "password": "wrong"}

    assert (await client.post("/auth/login", json=body)).status_code == 401
    assert (await client.post("/auth/login", json=body)).status_code == 401
    blocked = await client.post("/auth/login", json=body)

    assert blocked.status_code == 429
    assert blocked.json()["code"] == "rate_limited"


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
    assert REFRESH_COOKIE not in res.cookies


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
    assert REFRESH_COOKIE not in res.cookies
    assert res.headers["cache-control"] == "no-store"

    token = await db_session.scalar(select(RefreshToken).where(RefreshToken.user_id == user.id))
    assert token.session_kind == "admin"


@pytest.mark.parametrize("role", ["admin", "manager"])
async def test_admin_login_access_token_can_load_me(client, db_session, role):
    user = await make_user(
        db_session,
        email=f"admin-me-{role}@test.local",
        password="pw",
        role=role,
    )
    login = await client.post(
        "/auth/admin/login",
        json={"email": user.email, "password": "pw"},
    )
    assert login.status_code == 200

    me = await client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )

    assert me.status_code == 200
    assert me.json()["id"] == str(user.id)
    assert me.json()["role"] == role


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
    first_refresh = login.cookies[REFRESH_COOKIE]

    # 회전 — 새 access + 새 refresh
    client.cookies.clear()
    client.cookies.set(REFRESH_COOKIE, first_refresh, path="/auth")
    rotated = await client.post("/auth/refresh")
    assert rotated.status_code == 200
    assert decode_access_token(rotated.json()["access_token"], settings)["session_kind"] == "store"
    second_refresh = rotated.cookies[REFRESH_COOKIE]
    assert second_refresh != first_refresh

    # 구 토큰 재사용 = 탈취 신호 → 401 + 유저 세션 전체 무효화
    client.cookies.clear()
    client.cookies.set(REFRESH_COOKIE, first_refresh, path="/auth")
    assert (await client.post("/auth/refresh")).status_code == 401

    client.cookies.clear()
    client.cookies.set(REFRESH_COOKIE, second_refresh, path="/auth")
    assert (await client.post("/auth/refresh")).status_code == 401

    active = await db_session.scalar(
        select(func.count()).select_from(RefreshToken).where(RefreshToken.revoked_at.is_(None))
    )
    assert active == 0


async def test_store_refresh_ignores_stale_generic_localhost_cookie(client, db_session):
    user = await make_user(db_session, email="cookie-collision@test.local", password="pw")
    login = await client.post(
        "/auth/login",
        json={"email": user.email, "password": "pw"},
    )
    assert login.status_code == 200

    stale_raw, stale_hash = new_refresh_token()
    db_session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=stale_hash,
            session_kind="store",
            expires_at=datetime.now(UTC) + timedelta(days=1),
            revoked_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    # Cookies ignore ports. Another localhost app can leave this generic root-path
    # cookie alongside ESSE SION's more specific store refresh cookie.
    client.cookies.set("refresh_token", stale_raw, path="/")
    refreshed = await client.post("/auth/refresh")

    assert refreshed.status_code == 200
    assert REFRESH_COOKIE in refreshed.cookies
    active = await db_session.scalar(
        select(func.count())
        .select_from(RefreshToken)
        .where(
            RefreshToken.user_id == user.id,
            RefreshToken.session_kind == "store",
            RefreshToken.revoked_at.is_(None),
        )
    )
    assert active == 1


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


async def test_store_refresh_rejects_privileged_store_session(client, db_session):
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

    client.cookies.set(REFRESH_COOKIE, raw, path="/auth")
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
    assert REFRESH_COOKIE in store_login.cookies
    assert "admin_refresh_token" in admin_login.cookies

    logout = await client.post("/auth/admin/logout")
    assert logout.status_code == 204
    assert (await client.post("/auth/refresh")).status_code == 200


async def test_logout_revokes_refresh(client, db_session):
    await make_user(db_session, email="o@test.local", password="pw")
    login = await client.post("/auth/login", json={"email": "o@test.local", "password": "pw"})
    raw = login.cookies[REFRESH_COOKIE]

    client.cookies.set(REFRESH_COOKIE, raw, path="/auth")
    assert (await client.post("/auth/logout")).status_code == 204

    client.cookies.clear()
    client.cookies.set(REFRESH_COOKIE, raw, path="/auth")
    assert (await client.post("/auth/refresh")).status_code == 401


async def test_phone_send_and_verify(app, client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)

    res = await client.post("/auth/phone/send", json={"phone": "010-1234-5678"}, headers=headers)
    assert res.status_code == 202
    sent = app.state.solapi.sent
    assert len(sent) == 1 and "인증번호는 [" in sent[0]["text"]
    match = re.search(r"인증번호는 \[(\d{6})\]", sent[0]["text"])
    assert match is not None
    code = match.group(1)
    verification = await db_session.scalar(
        select(PhoneVerification).order_by(PhoneVerification.created_at.desc())
    )
    assert verification is not None
    assert verification.code != code
    assert len(verification.code) == 64

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


async def test_phone_send_rejects_oversized_phone_before_sms(app, client, db_session, settings):
    user = await make_user(db_session)

    response = await client.post(
        "/auth/phone/send",
        json={"phone": "0" * 33},
        headers=auth_headers(user, settings),
    )

    assert response.status_code == 422
    assert app.state.solapi.sent == []


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


async def test_phone_verification_locks_record_after_five_failures(client, db_session, settings):
    user = await make_user(db_session)
    verification = PhoneVerification(
        user_id=user.id,
        phone="01088887777",
        code="654321",
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    db_session.add(verification)
    await db_session.commit()
    headers = auth_headers(user, settings)

    for _ in range(phone_service.MAX_VERIFY_ATTEMPTS - 1):
        wrong = await client.post(
            "/auth/phone/verify",
            json={"phone": verification.phone, "code": "000000"},
            headers=headers,
        )
        assert wrong.status_code == 400
        assert wrong.json()["code"] == "verification_mismatch"

    locked = await client.post(
        "/auth/phone/verify",
        json={"phone": verification.phone, "code": "000000"},
        headers=headers,
    )
    assert locked.status_code == 429

    # 잠긴 레코드는 이후 정답도 허용하지 않는다.
    correct = await client.post(
        "/auth/phone/verify",
        json={"phone": verification.phone, "code": verification.code},
        headers=headers,
    )
    assert correct.status_code == 429
    await db_session.refresh(verification)
    assert verification.failed_attempts == phone_service.MAX_VERIFY_ATTEMPTS
    assert verification.locked_at is not None
    assert verification.verified is False


async def test_phone_verification_rate_limits_by_user_and_ip(app, client, db_session, settings):
    user = await make_user(db_session)
    verification = PhoneVerification(
        user_id=user.id,
        phone="01066665555",
        code="654321",
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    db_session.add(verification)
    await db_session.commit()
    app.state.phone_verify_rate_limiter = AuthRateLimiter(
        attempts=1,
        window_seconds=60,
        max_keys=10,
        detail="전화번호 인증 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    )
    headers = auth_headers(user, settings)

    wrong = await client.post(
        "/auth/phone/verify",
        json={"phone": verification.phone, "code": "000000"},
        headers=headers,
    )
    blocked = await client.post(
        "/auth/phone/verify",
        json={"phone": verification.phone, "code": verification.code},
        headers=headers,
    )

    assert wrong.status_code == 400
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "rate_limited"


async def test_phone_verification_concurrent_failures_cap_attempts_atomically(
    app, db_session, settings
):
    user = await make_user(db_session)
    verification = PhoneVerification(
        user_id=user.id,
        phone="01077776666",
        code="654321",
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    db_session.add(verification)
    await db_session.commit()

    async def attempt() -> Exception | None:
        async with app.state.sessionmaker() as session:
            current_user = await session.get(User, user.id)
            assert current_user is not None
            try:
                await phone_service.verify_code(
                    session,
                    current_user,
                    verification.phone,
                    "000000",
                    secret=settings.session_secret,
                )
            except (DomainError, RateLimitedError) as exc:
                return exc
        return None

    results = await asyncio.wait_for(
        asyncio.gather(*(attempt() for _ in range(10))),
        timeout=5,
    )

    assert all(isinstance(result, (DomainError, RateLimitedError)) for result in results)
    await db_session.refresh(verification)
    assert verification.failed_attempts == phone_service.MAX_VERIFY_ATTEMPTS
    assert verification.locked_at is not None


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
    linked = await ensure_oauth_user(
        db_session,
        "google",
        "g-123",
        "link@test.local",
        "구글이름",
        email_verified=True,
    )
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
            email_verified=True,
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


async def test_oauth_unverified_email_does_not_link_existing_user(db_session):
    await seed_setting(db_session, "design_token_initial_grant", "30")
    existing = await make_user(db_session, email="unverified-link@test.local")
    social = await ensure_oauth_user(
        db_session,
        "kakao",
        "unverified-kakao",
        existing.email,
        "카카오 이름",
        email_verified=False,
    )

    assert social.id != existing.id
    assert social.email is None
    identity = await db_session.scalar(
        select(UserIdentity).where(UserIdentity.provider_user_id == "unverified-kakao")
    )
    assert identity is not None and identity.user_id == social.id


class _OAuthProfileClient:
    def __init__(self, *, token: dict, profile: dict | None = None):
        self.token = token
        self.profile = profile

    async def authorize_access_token(self, request):
        return self.token

    async def get(self, path: str, *, token: dict):
        profile = self.profile

        class _Response:
            def json(self) -> dict:
                assert profile is not None
                return profile

        return _Response()


@pytest.mark.parametrize(
    ("claim", "expected"),
    [(True, True), (False, False), ("true", False), (None, False)],
)
async def test_google_profile_requires_boolean_verified_email(claim, expected):
    client = _OAuthProfileClient(
        token={
            "userinfo": {
                "sub": "google-sub",
                "email": "google@test.local",
                "name": "Google User",
                "email_verified": claim,
            }
        }
    )

    profile = await fetch_profile(client, "google", cast("Request", object()))

    assert profile.email_verified is expected


@pytest.mark.parametrize(
    ("valid", "verified", "expected"),
    [(True, True, True), (True, False, False), (False, True, False), ("true", True, False)],
)
async def test_kakao_profile_requires_valid_and_verified_email(valid, verified, expected):
    client = _OAuthProfileClient(
        token={},
        profile={
            "id": 123,
            "kakao_account": {
                "email": "kakao@test.local",
                "is_email_valid": valid,
                "is_email_verified": verified,
                "profile": {"nickname": "Kakao User"},
            },
        },
    )

    profile = await fetch_profile(client, "kakao", cast("Request", object()))

    assert profile.email_verified is expected


@pytest.mark.parametrize(
    ("email", "expected"),
    [
        ("user@naver.com", True),
        ("User@NAVER.com", True),
        ("user@gmail.com", False),  # 외부 연락처 이메일은 소유 증빙 없음 — 자동 링크 금지
        (None, False),
    ],
)
async def test_naver_profile_trusts_only_naver_account_email(email, expected):
    client = _OAuthProfileClient(
        token={},
        profile={
            "resultcode": "00",
            "response": {"id": "naver-123", "email": email, "name": "네이버 유저"},
        },
    )

    profile = await fetch_profile(client, "naver", cast("Request", object()))

    assert profile.provider_user_id == "naver-123"
    assert profile.email_verified is expected


class _FormRequest:
    """Apple form_post 콜백 흉내 — request.form()의 user 필드만 제공."""

    def __init__(self, form: dict):
        self._form = form

    async def form(self) -> dict:
        return self._form


@pytest.mark.parametrize(
    ("claim", "expected"),
    [(True, True), ("true", True), ("false", False), (False, False), (None, False)],
)
async def test_apple_profile_accepts_bool_or_true_string_verified_email(claim, expected):
    client = _OAuthProfileClient(
        token={
            "userinfo": {
                "sub": "apple-sub",
                "email": "apple@privaterelay.appleid.com",
                "email_verified": claim,
            }
        }
    )

    profile = await fetch_profile(client, "apple", cast("Request", _FormRequest({})))

    assert profile.provider_user_id == "apple-sub"
    assert profile.email_verified is expected


@pytest.mark.parametrize(
    ("raw_user", "expected"),
    [
        ('{"name": {"lastName": "김", "firstName": "사과"}}', "김사과"),
        ('{"name": {"firstName": "Apple"}}', "Apple"),
        ("not-json", None),
        ('"just-a-string"', None),
        (None, None),
    ],
)
async def test_apple_profile_reads_name_from_first_auth_form_user(raw_user, expected):
    client = _OAuthProfileClient(token={"userinfo": {"sub": "apple-sub"}})
    form = {} if raw_user is None else {"user": raw_user}

    profile = await fetch_profile(client, "apple", cast("Request", _FormRequest(form)))

    assert profile.name == expected
    assert profile.email is None
    assert profile.email_verified is False


async def test_oauth_same_identity_first_callback_race_reuses_winner(app, db_session):
    await seed_setting(db_session, "design_token_initial_grant", "30")

    async def callback() -> uuid.UUID:
        async with app.state.sessionmaker() as session:
            user = await ensure_oauth_user(
                session,
                "google",
                "concurrent-google",
                "concurrent-google@test.local",
                "동시 사용자",
                email_verified=True,
            )
            return user.id

    user_ids = await asyncio.gather(*(callback() for _ in range(6)))

    assert len(set(user_ids)) == 1
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(UserIdentity)
            .where(UserIdentity.provider_user_id == "concurrent-google")
        )
        == 1
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.email == "concurrent-google@test.local")
        )
        == 1
    )


async def test_oauth_verified_email_cross_provider_race_links_one_user(app, db_session):
    await seed_setting(db_session, "design_token_initial_grant", "30")

    async def callback(provider: str, provider_user_id: str) -> uuid.UUID:
        async with app.state.sessionmaker() as session:
            user = await ensure_oauth_user(
                session,
                provider,
                provider_user_id,
                "shared-verified@test.local",
                "공유 사용자",
                email_verified=True,
            )
            return user.id

    user_ids = await asyncio.gather(
        callback("google", "cross-google"),
        callback("kakao", "cross-kakao"),
    )

    assert user_ids[0] == user_ids[1]
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(UserIdentity)
            .where(UserIdentity.user_id == user_ids[0])
        )
        == 2
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


async def test_access_token_without_session_kind_is_rejected(client, db_session, settings):
    customer = await make_user(db_session)
    customer_token = _access_token_without_session_kind(customer.id, customer.role, settings)
    assert (
        await client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {customer_token}"},
        )
    ).status_code == 401

    admin = await make_user(db_session, role="admin")
    admin_token = _access_token_without_session_kind(admin.id, admin.role, settings)
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
