"""기존(Supabase) → 새 스키마 데이터 변환 초안 (CHECKLIST 2단계, 정책은 db/MAPPING.md §3).

구현 범위: 유저 무관 데이터 6종. 유저 종속 테이블은 3단계에서 기존 유저 매칭 방식이
확정된 뒤 구현한다.

실행 (대상 DB는 alembic upgrade head 완료 상태여야 함):
    uv run python db/scripts/migrate_data.py \\
        --old-dsn "postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres" \\
        --new-dsn "postgresql://essesion:essesion@localhost:5432/essesion" \\
        [--only products,motifs]

DSN은 asyncpg 원형(postgresql://) — SQLAlchemy의 postgresql+asyncpg:// URL이 아니다.
각 테이블은 clean-target 전제(대상 비어 있음 assert) + 단일 트랜잭션 — 리허설·컷오버
절차와 부합(멱등 재실행 대신 실패 시 대상 비우고 재시도).
"""

import argparse
import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import asyncpg
from pgvector.asyncpg import register_vector

Migrator = Callable[[asyncpg.Connection, asyncpg.Connection], Awaitable[None]]


async def _copy_rows(
    old: asyncpg.Connection,
    new: asyncpg.Connection,
    table: str,
    columns: list[str],
    transform: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> None:
    existing = await new.fetchval(f"SELECT count(*) FROM {table}")
    if existing:
        raise SystemExit(f"{table}: 대상에 이미 {existing}행 존재 — clean-target 전제 위반")

    col_list = ", ".join(columns)
    rows = [dict(r) for r in await old.fetch(f"SELECT {col_list} FROM {table}")]
    if transform:
        rows = [transform(r) for r in rows]
    if not rows:
        print(f"  {table}: 원본 0행")
        return

    placeholders = ", ".join(f"${i + 1}" for i in range(len(columns)))
    await new.executemany(
        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})",
        [tuple(r[c] for c in columns) for r in rows],
    )
    print(f"  {table}: {len(rows)}행 이관")


def _null_updated_by(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "updated_by": None}  # 유저 미이관 — MAPPING.md §3


async def migrate_products(old: asyncpg.Connection, new: asyncpg.Connection) -> None:
    await _copy_rows(
        old,
        new,
        "products",
        [
            "id",
            "code",
            "name",
            "price",
            "image",
            "category",
            "color",
            "pattern",
            "material",
            "info",
            "detail_images",
            "stock",
            "option_label",
            "created_at",
            "updated_at",
        ],
    )
    await new.execute(
        "SELECT setval(pg_get_serial_sequence('products', 'id'),"
        " (SELECT coalesce(max(id), 1) FROM products))"
    )


async def migrate_product_options(old: asyncpg.Connection, new: asyncpg.Connection) -> None:
    await _copy_rows(
        old,
        new,
        "product_options",
        ["id", "product_id", "name", "additional_price", "stock", "created_at"],
    )


async def migrate_coupons(old: asyncpg.Connection, new: asyncpg.Connection) -> None:
    await _copy_rows(
        old,
        new,
        "coupons",
        [
            "id",
            "name",
            "display_name",
            "discount_type",
            "discount_value",
            "max_discount_amount",
            "description",
            "expiry_date",
            "additional_info",
            "is_active",
            "created_at",
            "updated_at",
        ],
    )


async def migrate_pricing_constants(old: asyncpg.Connection, new: asyncpg.Connection) -> None:
    await _copy_rows(
        old,
        new,
        "pricing_constants",
        ["key", "amount", "category", "updated_at", "updated_by"],
        transform=_null_updated_by,
    )


async def migrate_admin_settings(old: asyncpg.Connection, new: asyncpg.Connection) -> None:
    await _copy_rows(
        old,
        new,
        "admin_settings",
        ["key", "value", "updated_at", "updated_by"],
        transform=_null_updated_by,
    )


async def migrate_motifs(old: asyncpg.Connection, new: asyncpg.Connection) -> None:
    await _copy_rows(
        old,
        new,
        "motifs",
        [
            "id",
            "symbol",
            "color_slots",
            "bbox",
            "anchor",
            "subject",
            "scope",
            "view",
            "expression",
            "style",
            "description",
            "tags",
            "embedding",
            "source",
            "quality",
            "variant_group",
            "created_at",
        ],
    )


def _stub(table: str) -> Migrator:
    async def _not_implemented(old: asyncpg.Connection, new: asyncpg.Connection) -> None:
        raise NotImplementedError(
            f"{table}: 유저 종속 — 3단계에서 기존 유저 매칭 확정 후 구현 (MAPPING.md §3)"
        )

    return _not_implemented


MIGRATORS: dict[str, Migrator] = {
    "products": migrate_products,
    "product_options": migrate_product_options,
    "coupons": migrate_coupons,
    "pricing_constants": migrate_pricing_constants,
    "admin_settings": migrate_admin_settings,
    "motifs": migrate_motifs,
    # 유저 종속 — 스텁
    "shipping_addresses": _stub("shipping_addresses"),
    "orders": _stub("orders"),
    "claims": _stub("claims"),
    "user_coupons": _stub("user_coupons"),
    "inquiries": _stub("inquiries"),
    "quote_requests": _stub("quote_requests"),
    "design_tokens": _stub("design_tokens"),
    "token_purchases": _stub("token_purchases"),
    "images": _stub("images"),
}

IMPLEMENTED = [
    "products",
    "product_options",
    "coupons",
    "pricing_constants",
    "admin_settings",
    "motifs",
]


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--old-dsn", required=True, help="기존 Supabase Postgres DSN")
    parser.add_argument("--new-dsn", required=True, help="새 DB DSN (asyncpg 원형)")
    parser.add_argument("--only", help="쉼표 구분 테이블 목록 (기본: 구현된 전부)")
    args = parser.parse_args()

    selected = args.only.split(",") if args.only else IMPLEMENTED
    unknown = set(selected) - set(MIGRATORS)
    if unknown:
        raise SystemExit(f"알 수 없는 테이블: {', '.join(sorted(unknown))}")

    old = await asyncpg.connect(args.old_dsn)
    new = await asyncpg.connect(args.new_dsn)
    await register_vector(old)
    await register_vector(new)
    try:
        for name in selected:
            print(f"[{name}]")
            async with new.transaction():
                await MIGRATORS[name](old, new)
    finally:
        await old.close()
        await new.close()


if __name__ == "__main__":
    asyncio.run(main())
