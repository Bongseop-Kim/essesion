"""관리자 토큰 회수와 사용 차감의 버킷별 잔액 불변식 — 실제 PostgreSQL."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from api.domains.tokens import ledger
from api.errors import DomainError
from db.models.commerce import AdminOperationLog
from db.models.tokens import DesignToken
from sqlalchemy import func, select

from .factories import auth_headers, make_admin, make_user, seed_setting

COST_SETTING = ("design_token_cost_openai_render_standard", "5")
TOKEN_CLASSES = ("paid", "bonus", "free")


async def _class_balances(db_session, user_id) -> dict[str, int]:
    rows = (
        await db_session.execute(
            select(DesignToken.token_class, func.sum(DesignToken.amount))
            .where(DesignToken.user_id == user_id)
            .group_by(DesignToken.token_class)
        )
    ).all()
    balances = {token_class: 0 for token_class in TOKEN_CLASSES}
    balances.update({token_class: int(amount) for token_class, amount in rows})
    return balances


def _adjustment_payload(user_id, amount: int, *, operation_id=None) -> dict:
    return {
        "operation_id": str(operation_id or uuid.uuid4()),
        "user_id": str(user_id),
        "amount": amount,
        "description": "잔액 불변식 회귀 검증",
    }


async def test_bonus_clawback_then_use_reaches_zero_without_negative_bucket(
    client, db_session, settings
):
    await seed_setting(db_session, *COST_SETTING)
    admin = await make_admin(db_session)
    customer = await make_user(db_session)
    db_session.add(
        DesignToken(
            user_id=customer.id,
            amount=10,
            type="grant",
            token_class="bonus",
        )
    )
    await db_session.commit()

    adjusted = await client.post(
        "/admin/tokens/manage",
        json=_adjustment_payload(customer.id, -5),
        headers=auth_headers(admin, settings),
    )
    assert adjusted.status_code == 200
    assert adjusted.json()["new_balance"] == 5
    assert await _class_balances(db_session, customer.id) == {
        "paid": 0,
        "bonus": 5,
        "free": 0,
    }

    used = await ledger.use_tokens(db_session, customer.id, "bonus-after-admin-clawback")
    assert used.success is True
    assert used.balance == 0
    assert await _class_balances(db_session, customer.id) == {
        "paid": 0,
        "bonus": 0,
        "free": 0,
    }


async def test_mixed_clawback_uses_paid_then_bonus_and_preserves_expiry(
    client, db_session, settings
):
    admin = await make_admin(db_session)
    customer = await make_user(db_session)
    paid_expiry = datetime.now(UTC) + timedelta(days=30)
    db_session.add_all(
        [
            DesignToken(
                user_id=customer.id,
                amount=3,
                type="purchase",
                token_class="paid",
                expires_at=paid_expiry,
            ),
            DesignToken(
                user_id=customer.id,
                amount=7,
                type="grant",
                token_class="bonus",
            ),
        ]
    )
    await db_session.commit()

    adjusted = await client.post(
        "/admin/tokens/manage",
        json=_adjustment_payload(customer.id, -5),
        headers=auth_headers(admin, settings),
    )

    assert adjusted.status_code == 200
    assert adjusted.json()["new_balance"] == 5
    assert await _class_balances(db_session, customer.id) == {
        "paid": 0,
        "bonus": 5,
        "free": 0,
    }
    debits = list(
        await db_session.scalars(
            select(DesignToken).where(
                DesignToken.user_id == customer.id,
                DesignToken.type == "admin",
                DesignToken.amount < 0,
            )
        )
    )
    by_class = {row.token_class: row for row in debits}
    assert by_class["paid"].amount == -3
    assert by_class["paid"].expires_at == paid_expiry
    assert by_class["bonus"].amount == -2


async def test_clawback_over_balance_is_rejected_without_ledger_write(client, db_session, settings):
    admin = await make_admin(db_session)
    customer = await make_user(db_session)
    db_session.add(DesignToken(user_id=customer.id, amount=4, type="grant", token_class="free"))
    await db_session.commit()

    rejected = await client.post(
        "/admin/tokens/manage",
        json=_adjustment_payload(customer.id, -5),
        headers=auth_headers(admin, settings),
    )

    assert rejected.status_code == 400
    assert rejected.json() == {"detail": "insufficient_tokens", "code": "insufficient_tokens"}
    assert await _class_balances(db_session, customer.id) == {
        "paid": 0,
        "bonus": 0,
        "free": 4,
    }
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(DesignToken)
            .where(DesignToken.user_id == customer.id, DesignToken.type == "admin")
        )
        == 0
    )


async def test_concurrent_replay_of_negative_adjustment_is_idempotent(client, db_session, settings):
    admin = await make_admin(db_session)
    customer = await make_user(db_session)
    db_session.add(DesignToken(user_id=customer.id, amount=10, type="grant", token_class="bonus"))
    await db_session.commit()
    operation_id = uuid.uuid4()
    payload = _adjustment_payload(customer.id, -4, operation_id=operation_id)
    headers = auth_headers(admin, settings)

    first, second = await asyncio.gather(
        client.post("/admin/tokens/manage", json=payload, headers=headers),
        client.post("/admin/tokens/manage", json=payload, headers=headers),
    )

    assert first.status_code == second.status_code == 200
    assert first.json()["new_balance"] == second.json()["new_balance"] == 6
    assert await _class_balances(db_session, customer.id) == {
        "paid": 0,
        "bonus": 6,
        "free": 0,
    }
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(DesignToken)
            .where(
                DesignToken.user_id == customer.id,
                DesignToken.type == "admin",
                DesignToken.amount < 0,
            )
        )
        == 1
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(AdminOperationLog)
            .where(AdminOperationLog.operation_id == str(operation_id))
        )
        == 1
    )


async def test_concurrent_distinct_clawbacks_cannot_overdraw(client, db_session, settings):
    admin = await make_admin(db_session)
    customer = await make_user(db_session)
    db_session.add(DesignToken(user_id=customer.id, amount=10, type="grant", token_class="bonus"))
    await db_session.commit()
    headers = auth_headers(admin, settings)

    first, second = await asyncio.gather(
        client.post(
            "/admin/tokens/manage",
            json=_adjustment_payload(customer.id, -7),
            headers=headers,
        ),
        client.post(
            "/admin/tokens/manage",
            json=_adjustment_payload(customer.id, -7),
            headers=headers,
        ),
    )

    assert sorted((first.status_code, second.status_code)) == [200, 400]
    rejected = first if first.status_code == 400 else second
    assert rejected.json()["code"] == "insufficient_tokens"
    assert await _class_balances(db_session, customer.id) == {
        "paid": 0,
        "bonus": 3,
        "free": 0,
    }


async def test_use_tokens_rejects_preexisting_negative_bucket(db_session):
    await seed_setting(db_session, *COST_SETTING)
    customer = await make_user(db_session)
    db_session.add_all(
        [
            DesignToken(user_id=customer.id, amount=10, type="grant", token_class="free"),
            DesignToken(user_id=customer.id, amount=-1, type="admin", token_class="bonus"),
        ]
    )
    await db_session.commit()

    with pytest.raises(DomainError) as error:
        await ledger.use_tokens(db_session, customer.id, "corrupt-bucket")

    assert error.value.code == "token_balance_invariant_violation"
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(DesignToken)
            .where(DesignToken.user_id == customer.id, DesignToken.type == "use")
        )
        == 0
    )


async def test_use_tokens_debits_free_without_creating_negative_bonus(db_session):
    await seed_setting(db_session, *COST_SETTING)
    customer = await make_user(db_session)
    db_session.add(DesignToken(user_id=customer.id, amount=5, type="grant", token_class="free"))
    await db_session.commit()

    used = await ledger.use_tokens(db_session, customer.id, "free-only")

    assert used.success is True
    assert used.balance == 0
    assert await _class_balances(db_session, customer.id) == {
        "paid": 0,
        "bonus": 0,
        "free": 0,
    }
    debit = await db_session.scalar(
        select(DesignToken).where(
            DesignToken.user_id == customer.id,
            DesignToken.type == "use",
        )
    )
    assert debit is not None
    assert debit.token_class == "free"
