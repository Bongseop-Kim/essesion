import json

from sqlalchemy import text

from .factories import make_user


def _index_names(node: dict) -> set[str]:
    names = {name for name in [node.get("Index Name")] if isinstance(name, str)}
    for child in node.get("Plans", []):
        names.update(_index_names(child))
    return names


def _node_types(node: dict) -> set[str]:
    types = {node["Node Type"]} if isinstance(node.get("Node Type"), str) else set()
    for child in node.get("Plans", []):
        types.update(_node_types(child))
    return types


async def test_representative_order_queue_uses_admin_list_index(db_session) -> None:
    customer = await make_user(db_session)
    await db_session.execute(
        text(
            """
            INSERT INTO orders (
                id, user_id, order_number, order_type, status,
                total_price, original_price, created_at, updated_at
            )
            SELECT
                gen_random_uuid(),
                :user_id,
                'PLAN-' || value,
                'sale',
                CASE WHEN value <= 25 THEN '대기중' ELSE '완료' END,
                10000,
                10000,
                now() - make_interval(secs => value),
                now()
            FROM generate_series(1, 10000) AS value
            """
        ),
        {"user_id": customer.id},
    )
    await db_session.commit()
    await db_session.execute(text("ANALYZE orders"))

    raw_plan = await db_session.scalar(
        text(
            """
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT id
            FROM orders
            WHERE status = '대기중' AND order_type = 'sale'
            ORDER BY created_at DESC, id DESC
            LIMIT 20
            """
        )
    )
    plan = json.loads(raw_plan) if isinstance(raw_plan, str) else raw_plan
    assert isinstance(plan, list)
    root = plan[0]["Plan"]
    # PostgreSQL may correctly prefer the narrower partial index for the pending
    # queue over the general admin-list index.  The performance contract is that
    # the representative queue is index-backed and does not regress to a table
    # scan, not that the planner must choose one specific valid index.
    assert _index_names(root) & {
        "ix_orders_admin_list",
        "ix_orders_stale_pending_created_at",
    }
    assert "Seq Scan" not in _node_types(root)
    assert root["Actual Rows"] <= 20


async def test_representative_product_filter_uses_admin_list_index(db_session) -> None:
    await db_session.execute(
        text(
            """
            INSERT INTO products (
                code, name, price, image, category, color, pattern, material,
                info, created_at, updated_at
            )
            SELECT
                'PLAN-PRODUCT-' || value,
                '규모 검증 상품 ' || value,
                10000,
                'https://assets.example/plan.png',
                CASE WHEN value <= 25 THEN '3fold' ELSE 'knit' END,
                'navy',
                'solid',
                'silk',
                'query-plan fixture',
                now() - make_interval(secs => value),
                now()
            FROM generate_series(1, 10000) AS value
            """
        )
    )
    await db_session.commit()
    await db_session.execute(text("ANALYZE products"))

    raw_plan = await db_session.scalar(
        text(
            """
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT id
            FROM products
            WHERE category = '3fold'
            ORDER BY created_at DESC, id DESC
            LIMIT 20
            """
        )
    )
    plan = json.loads(raw_plan) if isinstance(raw_plan, str) else raw_plan
    assert isinstance(plan, list)
    root = plan[0]["Plan"]
    assert "ix_products_admin_list" in _index_names(root)
    assert "Seq Scan" not in _node_types(root)
    assert root["Actual Rows"] <= 20
