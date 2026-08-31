import asyncio

import asyncpg
from alembic import command
from db.testing import POSTGRES_IMAGE, alembic_config, migrated_postgres
from testcontainers.postgres import PostgresContainer


def test_upgrade_head_applies_and_matches_models():
    # 리비전 id를 나열하지 않는다 — 마이그레이션마다 깨지기만 하고, 분기·다중 head는
    # alembic이 `head` 해석 단계에서 이미 CommandError로 막는다. 여기서 볼 건 정주행·역주행이
    # 실제 Postgres에 적용되고 최종 스키마가 모델과 일치하는지다.
    with migrated_postgres() as url:
        config = alembic_config(url)
        command.downgrade(config, "base")
        command.upgrade(config, "head")
        command.check(config)


async def _seed_legacy_repair_pickups(url: str) -> None:
    connection = await asyncpg.connect(url.replace("postgresql+asyncpg://", "postgresql://"))
    try:
        await connection.execute(
            "INSERT INTO users (id, name) VALUES "
            "('10000000-0000-0000-0000-000000000001', 'migration user')"
        )
        await connection.execute(
            "INSERT INTO orders "
            "(id, user_id, order_number, order_type, status, total_price, original_price, "
            "shipping_cost, paid_at) VALUES "
            "('20000000-0000-0000-0000-000000000001', "
            "'10000000-0000-0000-0000-000000000001', 'ORD-MIGRATION-001', 'repair', "
            "'수거예정', 20000, 12000, 3000, now()), "
            "('20000000-0000-0000-0000-000000000002', "
            "'10000000-0000-0000-0000-000000000001', 'ORD-MIGRATION-002', 'repair', "
            "'접수', 20000, 12000, 3000, now()), "
            "('20000000-0000-0000-0000-000000000003', "
            "'10000000-0000-0000-0000-000000000001', 'ORD-MIGRATION-003', 'repair', "
            "'접수', 20000, 12000, 3000, now())"
        )
        await connection.execute(
            "INSERT INTO repair_pickup_requests "
            "(order_id, recipient_name, recipient_phone, address, pickup_fee) VALUES "
            "('20000000-0000-0000-0000-000000000001', '수령인', '01000000000', '주소', 5000)"
        )
        await connection.execute(
            "INSERT INTO order_status_logs "
            "(order_id, previous_status, new_status, is_rollback) VALUES "
            "('20000000-0000-0000-0000-000000000002', '수거예정', '접수', false)"
        )
    finally:
        await connection.close()


async def _assert_repair_pickup_upgrade(url: str) -> None:
    connection = await asyncpg.connect(url.replace("postgresql+asyncpg://", "postgresql://"))
    try:
        migrated = await connection.fetchrow(
            "SELECT status, total_price, shipping_cost FROM orders "
            "WHERE id = '20000000-0000-0000-0000-000000000001'"
        )
        assert tuple(migrated.values()) == ("발송대기", 20000, 8000)
        assert (
            await connection.fetchval(
                "SELECT count(*) FROM order_status_logs WHERE order_id = "
                "'20000000-0000-0000-0000-000000000001' AND previous_status = '수거예정' "
                "AND new_status = '발송대기'"
            )
            == 1
        )
        incident = await connection.fetchrow(
            "SELECT type, status, details->>'pickup_fee' AS pickup_fee "
            "FROM payment_incidents WHERE operation_id = "
            "'repair-pickup-removal:20000000-0000-0000-0000-000000000001'"
        )
        assert tuple(incident.values()) == ("partial_cancel", "open", "5000")
        assert (
            await connection.fetchval(
                "SELECT count(*) FROM order_status_logs WHERE order_id = "
                "'20000000-0000-0000-0000-000000000002' AND previous_status = '수거예정' "
                "AND new_status = '접수'"
            )
            == 1
        )
        assert (
            await connection.fetchval(
                "SELECT count(*) FROM order_status_logs WHERE order_id = "
                "'20000000-0000-0000-0000-000000000003' AND new_status = '접수'"
            )
            == 0
        )
        assert await connection.fetchval("SELECT to_regclass('repair_pickup_requests')") is None
    finally:
        await connection.close()


def test_repair_pickup_upgrade_preserves_money_and_rollback_evidence():
    with PostgresContainer(POSTGRES_IMAGE, driver="asyncpg") as postgres:
        url = postgres.get_connection_url()
        config = alembic_config(url)
        command.upgrade(config, "c8b2e5f1a094")
        asyncio.run(_seed_legacy_repair_pickups(url))
        command.upgrade(config, "e6b3d15a9c47")
        asyncio.run(_assert_repair_pickup_upgrade(url))
