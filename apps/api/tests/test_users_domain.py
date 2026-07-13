"""마이페이지 — 프로필·알림 설정 로그·배송지·탈퇴 (domains.md §2·§3·§6)."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from api import deps
from api.domains.auth import phone as phone_service
from api.domains.users.router import ShippingAddressIn, upsert_address
from api.errors import UnauthorizedError
from db.models.auth import PhoneVerification, User
from db.models.commerce import Inquiry, NotificationPreferenceLog, ShippingAddress
from db.models.tokens import DesignToken
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


async def test_delete_account_with_only_initial_design_token_hard_deletes_without_fk_error(
    client, db_session, settings
):
    user = await make_user(db_session)
    user_id = user.id
    token = DesignToken(
        user_id=user_id,
        amount=30,
        type="grant",
        token_class="free",
        description="신규 가입 토큰 지급",
    )
    db_session.add(token)
    await db_session.commit()
    token_id = token.id

    res = await client.delete("/users/me", headers=auth_headers(user, settings))

    assert res.status_code == 204
    db_session.expire_all()
    assert await db_session.get(User, user_id) is None
    assert await db_session.get(DesignToken, token_id) is None


async def test_delete_account_with_non_initial_design_token_soft_deletes(
    client, db_session, settings
):
    user = await make_user(db_session)
    user_id = user.id
    db_session.add(
        DesignToken(
            user_id=user_id,
            amount=5,
            type="admin",
            token_class="free",
            description="관리자 지급",
        )
    )
    await db_session.commit()

    res = await client.delete("/users/me", headers=auth_headers(user, settings))

    assert res.status_code == 204
    db_session.expire_all()
    survivor = await db_session.get(User, user_id)
    assert survivor is not None
    assert survivor.is_active is False
    assert survivor.deleted_at is not None


async def test_delete_account_soft_when_history(client, db_session, settings):
    user = await make_user(db_session)
    user_id = user.id
    headers = auth_headers(user, settings)
    await make_order(db_session, user)
    db_session.add(
        ShippingAddress(
            user_id=user.id,
            recipient_name="삭제 대상",
            recipient_phone="01012345678",
            postal_code="04524",
            address="서울",
            address_detail="상세",
            is_default=True,
        )
    )
    db_session.add(
        PhoneVerification(
            user_id=user.id,
            phone="01012345678",
            code="legacy-plain-code",
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
        )
    )
    await db_session.commit()
    res = await client.delete("/users/me", headers=headers)
    assert res.status_code == 204

    db_session.expire_all()
    survivor = await db_session.get(User, user_id)
    assert survivor is not None
    assert survivor.is_active is False
    assert survivor.name == "탈퇴회원" and survivor.email is None
    assert survivor.deleted_at is not None
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(ShippingAddress)
            .where(ShippingAddress.user_id == user_id)
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(PhoneVerification)
            .where(PhoneVerification.user_id == user_id)
        )
        == 0
    )

    # 비활성 계정은 인증 거부
    me = await client.get("/auth/me", headers=auth_headers(user, settings))
    assert me.status_code == 401


async def test_soft_delete_blocks_stale_phone_and_address_mutations(
    app, client, db_session, settings
):
    user = await make_user(db_session)
    user_id = user.id
    await make_order(db_session, user)

    async with (
        app.state.sessionmaker() as phone_session,
        app.state.sessionmaker() as address_session,
    ):
        stale_phone_user = await phone_session.get(User, user_id)
        stale_address_user = await address_session.get(User, user_id)
        assert stale_phone_user is not None and stale_address_user is not None

        deleted = await client.delete("/users/me", headers=auth_headers(user, settings))
        assert deleted.status_code == 204

        with pytest.raises(UnauthorizedError):
            await phone_service.send_verification(
                phone_session,
                stale_phone_user,
                "01012345678",
                app.state.solapi,
                secret=settings.session_secret,
            )
        await phone_session.rollback()

        with pytest.raises(UnauthorizedError):
            await upsert_address(
                ShippingAddressIn(
                    recipient_name="삭제 후 생성 시도",
                    recipient_phone="01012345678",
                    postal_code="04524",
                    address="서울",
                ),
                address_session,
                stale_address_user,
            )

    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(PhoneVerification)
            .where(PhoneVerification.user_id == user_id)
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(ShippingAddress)
            .where(ShippingAddress.user_id == user_id)
        )
        == 0
    )


async def test_account_delete_waits_for_authenticated_mutation_boundary(
    client, db_session, settings, monkeypatch
):
    """변경 요청이 인증된 뒤 탈퇴가 끼어들어 비활성 계정 데이터를 만들 수 없다."""
    user = await make_user(db_session)
    user_id = user.id
    headers = auth_headers(user, settings)
    mutation_locked = asyncio.Event()
    release_mutation = asyncio.Event()
    original_lock = deps.advisory_xact_lock
    paused = False

    async def pause_first_mutation(session, key):  # noqa: ANN001
        nonlocal paused
        await original_lock(session, key)
        if key == f"user:{user_id}" and not paused:
            paused = True
            mutation_locked.set()
            await release_mutation.wait()

    monkeypatch.setattr(deps, "advisory_xact_lock", pause_first_mutation)

    mutation_task = asyncio.create_task(
        client.post(
            "/inquiries",
            json={"title": "탈퇴 경합", "content": "먼저 시작된 변경"},
            headers=headers,
        )
    )
    await asyncio.wait_for(mutation_locked.wait(), timeout=5)
    delete_task = asyncio.create_task(client.delete("/users/me", headers=headers))
    completed_while_mutation_held, _ = await asyncio.wait({delete_task}, timeout=0.1)
    release_mutation.set()
    mutation_response, delete_response = await asyncio.wait_for(
        asyncio.gather(mutation_task, delete_task), timeout=5
    )

    assert not completed_while_mutation_held
    assert mutation_response.status_code == 201
    assert delete_response.status_code == 204
    db_session.expire_all()
    survivor = await db_session.get(User, user_id)
    assert survivor is not None and survivor.is_active is False
    assert (
        await db_session.scalar(
            select(func.count()).select_from(Inquiry).where(Inquiry.user_id == user_id)
        )
        == 1
    )
