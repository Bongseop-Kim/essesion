"""로컬 개발 시드 — 빈 로컬 DB 전용. 멱등(upsert/skip) — 여러 번 실행해도 안전.

운영 데이터 이관은 db/scripts/migrate_data.py 소관. 여기 가격 값들은 로컬 개발용
대표값이며 실값은 이관/관리자 화면이 공급한다.

실행: docker compose up -d && uv run alembic -c db/alembic.ini upgrade head
      && uv run python apps/api/scripts/seed.py
계정: admin@local / (SEED_ADMIN_PASSWORD, 기본 admin-local-password)
      customer@local / customer-local-password
"""

import asyncio
import os

from api.config import get_settings
from api.db import build_engine
from api.security import password_hasher
from db.models.auth import User
from db.models.commerce import AdminSetting, PricingConstant, Product, ProductOption
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import async_sessionmaker

ADMIN_SETTINGS = {
    "design_token_initial_grant": "30",
    "design_token_cost_openai_render_standard": "5",
}

PRICING: dict[str, tuple[int, str]] = {
    # reform
    "REFORM_BASE_COST": (15000, "reform"),
    "REFORM_WIDTH_COST": (10000, "reform"),
    "REFORM_SHIPPING_COST": (3000, "reform"),
    "REFORM_PICKUP_FEE": (5000, "reform"),
    # custom order
    "START_COST": (50000, "custom_order"),
    "SEWING_PER_COST": (4000, "custom_order"),
    "AUTO_TIE_COST": (1000, "custom_order"),
    "TRIANGLE_STITCH_COST": (500, "custom_order"),
    "SIDE_STITCH_COST": (500, "custom_order"),
    "BAR_TACK_COST": (300, "custom_order"),
    "DIMPLE_COST": (700, "custom_order"),
    "SPODERATO_COST": (800, "custom_order"),
    "FOLD7_COST": (900, "custom_order"),
    "WOOL_INTERLINING_COST": (600, "custom_order"),
    "BRAND_LABEL_COST": (300, "custom_order"),
    "CARE_LABEL_COST": (200, "custom_order"),
    "YARN_DYED_DESIGN_COST": (30000, "custom_order"),
    "FABRIC_PRINTING_SILK": (12000, "fabric"),
    "FABRIC_YARN_DYED_SILK": (16000, "fabric"),
    # sample
    "SAMPLE_SEWING_COST": (50000, "custom_order"),
    "SAMPLE_FABRIC_PRINTING_COST": (60000, "custom_order"),
    "SAMPLE_FABRIC_YARN_DYED_COST": (80000, "custom_order"),
    "SAMPLE_FABRIC_AND_SEWING_PRINTING_COST": (100000, "custom_order"),
    "SAMPLE_FABRIC_AND_SEWING_YARN_DYED_COST": (120000, "custom_order"),
    "sample_discount_sewing": (30000, "sample_discount"),
    "sample_discount_fabric_printing": (30000, "sample_discount"),
    "sample_discount_fabric_yarn_dyed": (40000, "sample_discount"),
    "sample_discount_fabric_and_sewing_printing": (50000, "sample_discount"),
    "sample_discount_fabric_and_sewing_yarn_dyed": (60000, "sample_discount"),
    # token plans
    "token_plan_starter_price": (2500, "token"),
    "token_plan_starter_amount": (100, "token"),
    "token_plan_popular_price": (6500, "token"),
    "token_plan_popular_amount": (300, "token"),
    "token_plan_pro_price": (18000, "token"),
    "token_plan_pro_amount": (1000, "token"),
}

PRODUCTS = [
    {
        "code": "3F-SEED-001",
        "name": "네이비 솔리드 쓰리폴드",
        "price": 39000,
        "image": "https://placehold.co/600x600",
        "category": "3fold",
        "color": "navy",
        "pattern": "solid",
        "material": "silk",
        "info": "시드 상품",
        "options": [("일반", 0, None), ("롱", 5000, 10)],
    },
    {
        "code": "KN-SEED-001",
        "name": "브라운 니트 타이",
        "price": 29000,
        "image": "https://placehold.co/600x600",
        "category": "knit",
        "color": "brown",
        "pattern": "solid",
        "material": "wool",
        "info": "시드 상품",
        "options": [],
    },
]


async def _ensure_user(session, email: str, name: str, role: str, password: str) -> None:
    if await session.scalar(select(User).where(User.email == email)):
        return
    session.add(
        User(email=email, name=name, role=role, password_hash=password_hasher.hash(password))
    )
    print(f"  user: {email} ({role})")


async def main() -> None:
    settings = get_settings()
    engine = build_engine(settings)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        await _ensure_user(
            session,
            "admin@local",
            "로컬관리자",
            "admin",
            os.environ.get("SEED_ADMIN_PASSWORD", "admin-local-password"),
        )
        await _ensure_user(
            session, "customer@local", "로컬고객", "customer", "customer-local-password"
        )

        for key, value in ADMIN_SETTINGS.items():
            await session.execute(
                pg_insert(AdminSetting)
                .values(key=key, value=value)
                .on_conflict_do_nothing(index_elements=[AdminSetting.key])
            )
        for key, (amount, category) in PRICING.items():
            await session.execute(
                pg_insert(PricingConstant)
                .values(key=key, amount=amount, category=category)
                .on_conflict_do_nothing(index_elements=[PricingConstant.key])
            )

        for spec in PRODUCTS:
            options = spec.pop("options")
            existing = await session.scalar(select(Product).where(Product.code == spec["code"]))
            if existing is None:
                product = Product(**spec)
                session.add(product)
                await session.flush()
                for name, additional_price, stock in options:
                    session.add(
                        ProductOption(
                            product_id=product.id,
                            name=name,
                            additional_price=additional_price,
                            stock=stock,
                        )
                    )
                print(f"  product: {spec['code']}")

        await session.commit()
    await engine.dispose()
    print("seed 완료")


if __name__ == "__main__":
    asyncio.run(main())
