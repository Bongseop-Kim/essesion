"""마이페이지 — 프로필·알림 설정 로그·배송지·탈퇴 (domains.md §2·§3·§6)."""

from db.models.auth import User
from db.models.commerce import NotificationPreferenceLog
from sqlalchemy import func, select

from .factories import auth_headers, make_order, make_user


async def test_profile_update_allowed_fields_only(client, db_session, settings):
    user = await make_user(db_session, phone="01012345678")
    headers = auth_headers(user, settings)
    res = await client.patch("/users/me", json={"name": "새이름"}, headers=headers)
    assert res.status_code == 200 and res.json()["name"] == "새이름"

    # 허용 외 필드(role·phone 등)는 스키마에 없음 — 무시됨
    res = await client.patch(
        "/users/me",
        json={"role": "admin", "phone": "01099998888"},
        headers=headers,
    )
    assert res.json()["role"] == "customer"
    assert res.json()["phone"] == "01012345678"


async def test_notification_preferences_log_only_on_change(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)

    res = await client.post(
        "/users/me/notification-preferences",
        json={"notification_consent": True},
        headers=headers,
    )
    assert res.json()["notification_consent"] is True

    # 동일 값 재설정 — 로그 없음
    await client.post(
        "/users/me/notification-preferences",
        json={"notification_consent": True},
        headers=headers,
    )
    count = await db_session.scalar(select(func.count()).select_from(NotificationPreferenceLog))
    assert count == 1


async def test_address_default_exclusivity(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    base = {
        "recipient_name": "김",
        "recipient_phone": "01011112222",
        "postal_code": "04524",
        "address": "서울",
        "is_default": True,
    }
    first = (await client.put("/users/me/addresses", json=base, headers=headers)).json()
    second = (await client.put("/users/me/addresses", json=base, headers=headers)).json()
    assert second["is_default"] is True

    addresses = (await client.get("/users/me/addresses", headers=headers)).json()
    defaults = [a for a in addresses if a["is_default"]]
    assert len(addresses) == 2 and len(defaults) == 1
    assert defaults[0]["id"] == second["id"] != first["id"]


async def test_delete_account_hard_when_no_history(client, db_session, settings):
    user = await make_user(db_session)
    user_id = user.id
    res = await client.delete("/users/me", headers=auth_headers(user, settings))
    assert res.status_code == 204
    db_session.expire_all()  # 앱 세션이 지운 행의 identity map 캐시 무효화
    assert await db_session.get(User, user_id) is None


async def test_delete_account_soft_when_history(client, db_session, settings):
    user = await make_user(db_session)
    user_id = user.id
    headers = auth_headers(user, settings)
    await make_order(db_session, user)
    res = await client.delete("/users/me", headers=headers)
    assert res.status_code == 204

    db_session.expire_all()
    survivor = await db_session.get(User, user_id)
    assert survivor is not None
    assert survivor.is_active is False
    assert survivor.name == "탈퇴회원" and survivor.email is None

    # 비활성 계정은 인증 거부
    me = await client.get("/auth/me", headers=auth_headers(user, settings))
    assert me.status_code == 401
