from datetime import UTC, datetime, timedelta

import pytest
from api.domains.auth.service import ensure_oauth_user
from db.models.auth import PhoneVerification, RefreshToken, UserIdentity
from db.models.tokens import DesignToken
from sqlalchemy import func, select

from .factories import auth_headers, make_user

pytestmark = pytest.mark.anyio if False else []  # asyncio_mode=auto


async def test_login_and_me(client, db_session):
    await make_user(db_session, email="a@test.local", password="pw-1234", name="김테스트")
    res = await client.post("/auth/login", json={"email": "a@test.local", "password": "pw-1234"})
    assert res.status_code == 200
    access = res.json()["access_token"]
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


async def test_me_requires_auth(client):
    assert (await client.get("/auth/me")).status_code == 401


async def test_refresh_rotation_and_reuse_detection(client, db_session):
    await make_user(db_session, email="r@test.local", password="pw")
    login = await client.post("/auth/login", json={"email": "r@test.local", "password": "pw"})
    first_refresh = login.cookies["refresh_token"]

    # 회전 — 새 access + 새 refresh
    client.cookies.clear()
    client.cookies.set("refresh_token", first_refresh, path="/auth")
    rotated = await client.post("/auth/refresh")
    assert rotated.status_code == 200
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


async def test_oauth_links_existing_user_by_email(db_session):
    existing = await make_user(db_session, email="link@test.local")
    linked = await ensure_oauth_user(db_session, "google", "g-123", "link@test.local", "구글이름")
    assert linked.id == existing.id
    identity = await db_session.scalar(
        select(UserIdentity).where(UserIdentity.provider == "google")
    )
    assert identity.user_id == existing.id
