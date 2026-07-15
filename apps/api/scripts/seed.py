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
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from api.config import get_settings
from api.db import build_engine
from api.security import password_hasher
from db.models.auth import User
from db.models.commerce import (
    AdminSetting,
    Coupon,
    Order,
    OrderItem,
    OrderStatusLog,
    PricingConstant,
    Product,
    ProductOption,
    RepairPickupRequest,
    RepairShippingReceipt,
    UserCoupon,
)
from db.models.images import Image
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import async_sessionmaker

ADMIN_SETTINGS = {
    "default_courier_company": "롯데택배",
    "design_token_initial_grant": "30",
    "design_token_cost_openai_render_standard": "5",
}

PRICING: dict[str, tuple[int, str]] = {
    # reform
    "REFORM_AUTOMATIC_COST": (16000, "reform"),
    "REFORM_WIDTH_COST": (30000, "reform"),
    "REFORM_RESTORATION_COST": (30000, "reform"),
    "REFORM_AUTOMATIC_COMBINED_COST": (40000, "reform"),
    "REFORM_WIDTH_RESTORATION_COST": (30000, "reform"),
    "REFORM_SHIPPING_COST": (4500, "reform"),
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
    "FABRIC_PRINTING_POLY": (8000, "fabric"),
    "FABRIC_PRINTING_SILK": (12000, "fabric"),
    "FABRIC_YARN_DYED_POLY": (12000, "fabric"),
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

TEST_COUPON_NAME = "local-cart-test-5000"
ADMIN_SMOKE_ORDER_NUMBER = "E2E-ADMIN-001"
CONTENT_ORDER_NUMBERS = {
    "custom": "E2E-CONTENT-CUSTOM-001",
    "sample": "E2E-CONTENT-SAMPLE-001",
    "repair": "E2E-CONTENT-REPAIR-001",
}


async def _ensure_user(session, email: str, name: str, role: str, password: str) -> None:
    if await session.scalar(select(User).where(User.email == email)):
        return
    session.add(
        User(email=email, name=name, role=role, password_hash=password_hasher.hash(password))
    )
    print(f"  user: {email} ({role})")


async def _ensure_test_coupon(session) -> None:
    expiry_date = date.today() + timedelta(days=365)
    expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=365)
    coupon_values = {
        "display_name": "로컬 테스트 5,000원 할인",
        "discount_type": "fixed",
        "discount_value": Decimal("5000"),
        "max_discount_amount": None,
        "description": "장바구니 쿠폰 UI 확인용 로컬 시드 쿠폰",
        "expiry_date": expiry_date,
        "additional_info": "로컬 개발 전용",
        "is_active": True,
    }
    coupon = await session.scalar(select(Coupon).where(Coupon.name == TEST_COUPON_NAME))
    if coupon is None:
        coupon = Coupon(
            name=TEST_COUPON_NAME,
            **coupon_values,
        )
        session.add(coupon)
        await session.flush()
        print(f"  coupon: {TEST_COUPON_NAME}")
    else:
        for key, value in coupon_values.items():
            setattr(coupon, key, value)
        await session.flush()

    customer_id = await session.scalar(select(User.id).where(User.email == "customer@local"))
    if customer_id is None:
        return

    await session.execute(
        pg_insert(UserCoupon)
        .values(
            user_id=customer_id,
            coupon_id=coupon.id,
            status="active",
            expires_at=expires_at,
        )
        .on_conflict_do_update(
            index_elements=[UserCoupon.user_id, UserCoupon.coupon_id],
            set_={"status": "active", "expires_at": expires_at, "used_at": None},
        )
    )


async def _ensure_admin_smoke_order(session) -> None:
    customer = await session.scalar(select(User).where(User.email == "customer@local"))
    product = await session.scalar(select(Product).where(Product.code == "3F-SEED-001"))
    if customer is None or product is None:
        return

    order = await session.scalar(
        select(Order).where(Order.order_number == ADMIN_SMOKE_ORDER_NUMBER)
    )
    if order is None:
        order = Order(
            user_id=customer.id,
            order_number=ADMIN_SMOKE_ORDER_NUMBER,
            order_type="sale",
            status="대기중",
            shipping_address_snapshot={
                "id": str(uuid.UUID("00000000-0000-4000-8000-000000000101")),
                "recipient_name": "로컬고객",
                "recipient_phone": "01000000000",
                "postal_code": "04524",
                "address": "서울시 중구 로컬로 1",
                "address_detail": "테스트",
                "delivery_memo": "문 앞",
                "delivery_request": None,
            },
            total_price=39000,
            original_price=39000,
            payment_group_id=uuid.UUID("00000000-0000-4000-8000-000000000102"),
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                item_id=str(product.id),
                item_type="product",
                product_id=product.id,
                item_data={
                    "product_snapshot": {
                        "id": product.id,
                        "code": product.code,
                        "name": product.name,
                        "image": product.image,
                    },
                    "option_snapshot": {"name": "일반"},
                },
                quantity=1,
                unit_price=39000,
            )
        )
        print(f"  order: {ADMIN_SMOKE_ORDER_NUMBER}")
        return

    # Playwright를 반복 실행해도 항상 같은 대표 전이를 다시 검증할 수 있게 복구한다.
    order.status = "대기중"
    await session.execute(delete(OrderStatusLog).where(OrderStatusLog.order_id == order.id))


async def _ensure_content_visibility_orders(session) -> None:
    customer = await session.scalar(select(User).where(User.email == "customer@local"))
    if customer is None:
        return

    now = datetime.now(timezone.utc)
    address = {
        "id": "00000000-0000-4000-8000-000000000201",
        "recipient_name": "로컬고객",
        "recipient_phone": "01012345678",
        "postal_code": "04524",
        "address": "서울시 중구 로컬로 1",
        "address_detail": "콘텐츠 확인",
        "delivery_request": "문 앞에 놓아 주세요.",
        "delivery_memo": "오후 배송 희망",
    }

    for kind, order_id, image_id, item_data in (
        (
            "custom",
            uuid.UUID("00000000-0000-4000-8000-000000000211"),
            uuid.UUID("00000000-0000-4000-8000-000000000221"),
            {
                "options": {
                    "fabric_type": "SILK",
                    "tie_type": "AUTO",
                    "triangle_stitch": True,
                    "lining_color": "navy",
                },
                "additional_notes": "광택을 낮춰 주세요.",
            },
        ),
        (
            "sample",
            uuid.UUID("00000000-0000-4000-8000-000000000212"),
            uuid.UUID("00000000-0000-4000-8000-000000000222"),
            {
                "sample_type": "fabric_and_sewing",
                "options": {"fabric_type": "POLY", "interlining": "WOOL"},
                "additional_notes": "봉제 간격을 확인해 주세요.",
            },
        ),
    ):
        if await session.scalar(
            select(Order.id).where(Order.order_number == CONTENT_ORDER_NUMBERS[kind])
        ):
            continue
        order = Order(
            id=order_id,
            user_id=customer.id,
            order_number=CONTENT_ORDER_NUMBERS[kind],
            order_type=kind,
            status="진행중",
            shipping_address_snapshot=address,
            total_price=50000,
            original_price=50000,
            payment_group_id=uuid.uuid4(),
        )
        session.add(order)
        item_data["reference_images"] = [{"image_id": str(image_id)}]
        session.add(
            OrderItem(
                order_id=order.id,
                item_id=f"{kind}-fixture",
                item_type=kind,
                item_data=item_data,
                quantity=2,
                unit_price=25000,
            )
        )
        session.add(
            Image(
                id=image_id,
                object_key=f"uploads/{kind}_order/fixture.png",
                entity_type=f"{kind}_order",
                entity_id=str(order.id),
                uploaded_by=customer.id,
                content_type="image/png",
                size_bytes=128,
                upload_completed_at=now,
            )
        )
        print(f"  order: {CONTENT_ORDER_NUMBERS[kind]}")

    repair_id = uuid.UUID("00000000-0000-4000-8000-000000000213")
    if await session.scalar(
        select(Order.id).where(Order.order_number == CONTENT_ORDER_NUMBERS["repair"])
    ):
        return
    repair = Order(
        id=repair_id,
        user_id=customer.id,
        order_number=CONTENT_ORDER_NUMBERS["repair"],
        order_type="repair",
        status="수선중",
        shipping_address_snapshot=address,
        total_price=46000,
        original_price=46000,
        shipping_cost=5000,
        payment_group_id=uuid.uuid4(),
    )
    original_key = "uploads/reform_upload/content-fixture.png"
    receipt_key = "uploads/repair_shipping_upload/content-fixture.png"
    session.add(repair)
    session.add(
        OrderItem(
            order_id=repair.id,
            item_id="repair-fixture",
            item_type="reform",
            item_data={
                "tie": {
                    "image": {"object_key": original_key},
                    "automatic": {
                        "mechanism": "zipper",
                        "wearer_height_cm": 175,
                        "dimple": True,
                        "turn_knot": True,
                    },
                    "width": {"target_width_cm": 7.5},
                    "restoration": {"memo": "원형을 유지해 주세요."},
                }
            },
            quantity=1,
            unit_price=41000,
        )
    )
    session.add(
        RepairPickupRequest(
            order_id=repair.id,
            recipient_name="로컬고객",
            recipient_phone="01012345678",
            postal_code="04524",
            address="서울시 중구 로컬로 1",
            detail_address="콘텐츠 확인",
            pickup_fee=5000,
        )
    )
    session.add(
        RepairShippingReceipt(
            id=uuid.UUID("00000000-0000-4000-8000-000000000231"),
            order_id=repair.id,
            receipt_type="no_tracking",
            reason="lost",
            memo="송장을 분실해 사진으로 접수합니다.",
            photos=[{"object_key": receipt_key}],
        )
    )
    session.add_all(
        [
            Image(
                id=uuid.UUID("00000000-0000-4000-8000-000000000223"),
                object_key=original_key,
                entity_type="reform",
                entity_id=str(repair.id),
                uploaded_by=customer.id,
                content_type="image/png",
                size_bytes=128,
                upload_completed_at=now,
            ),
            Image(
                id=uuid.UUID("00000000-0000-4000-8000-000000000224"),
                object_key=receipt_key,
                entity_type="repair_shipping",
                entity_id=str(repair.id),
                uploaded_by=customer.id,
                content_type="image/png",
                size_bytes=128,
                upload_completed_at=now,
            ),
        ]
    )
    print(f"  order: {CONTENT_ORDER_NUMBERS['repair']}")


async def main() -> None:
    settings = get_settings()
    if settings.env not in ("local", "test"):
        raise RuntimeError(
            "seed.py는 local/test 전용입니다. 운영 관리자는 bootstrap_admin.py를 사용하세요."
        )
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
                .on_conflict_do_update(
                    index_elements=[PricingConstant.key],
                    set_={"amount": amount, "category": category},
                )
            )
        await session.execute(
            delete(PricingConstant).where(PricingConstant.key == "REFORM_BASE_COST")
        )

        for spec in PRODUCTS:
            options = spec["options"]
            product_data = {key: value for key, value in spec.items() if key != "options"}
            existing = await session.scalar(
                select(Product).where(Product.code == product_data["code"])
            )
            if existing is None:
                product = Product(**product_data)
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
                print(f"  product: {product_data['code']}")

        await _ensure_test_coupon(session)
        await _ensure_admin_smoke_order(session)
        await _ensure_content_visibility_orders(session)

        await session.commit()
    await engine.dispose()
    print("seed 완료")


if __name__ == "__main__":
    asyncio.run(main())
