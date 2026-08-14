"""로컬 개발 시드 — 빈 로컬 DB 전용. 멱등(upsert/skip) — 여러 번 실행해도 안전.

가격 값은 로컬 개발용 대표값이며 배포 환경의 실값은 관리자 화면에서 설정한다.

실행: docker compose up -d && uv run alembic -c db/alembic.ini upgrade head
      && uv run python apps/api/scripts/seed.py
계정: admin@local / (SEED_ADMIN_PASSWORD, 기본 admin-local-password)
      customer@local / customer-local-password
"""

import asyncio
import base64
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import httpx
from api.config import get_settings
from api.db import build_engine
from api.domains.auth.service import grant_initial_tokens
from api.integrations.gcs import (
    assets_bucket_name,
    build_gcs_client,
    public_asset_url,
)
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
from db.models.tokens import DesignToken
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import async_sessionmaker

ADMIN_SETTINGS = {
    "default_courier_company": "롯데택배",
    "design_token_initial_grant": "30",
    "design_token_cost_openai_render_standard": "5",
    # 구성 수정은 flash-lite 1콜뿐이라 첫 생성보다 싸다 (6단계 미결 M1 확정).
    "design_edit_cost": "2",
    "design_finalize_daily_limit": "10",
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

PRODUCT_VARIANTS = [
    ("3F-SEED-001", "네이비 솔리드 쓰리폴드", 39000, "3fold", "navy", "solid", "silk"),
    ("3F-SEED-002", "와인 스트라이프 쓰리폴드", 42000, "3fold", "wine", "stripe", "silk"),
    ("3F-SEED-003", "그레이 체크 쓰리폴드", 36000, "3fold", "gray", "check", "cotton"),
    ("3F-SEED-004", "블루 도트 쓰리폴드", 38000, "3fold", "blue", "dot", "polyester"),
    ("SF-SEED-001", "블랙 솔리드 스포데라토", 45000, "sfolderato", "black", "solid", "silk"),
    ("SF-SEED-002", "실버 페이즐리 스포데라토", 47000, "sfolderato", "silver", "paisley", "silk"),
    ("SF-SEED-003", "베이지 체크 스포데라토", 41000, "sfolderato", "beige", "check", "wool"),
    ("KN-SEED-001", "브라운 니트 타이", 29000, "knit", "brown", "solid", "wool"),
    ("KN-SEED-002", "네이비 니트 타이", 31000, "knit", "navy", "stripe", "silk"),
    ("KN-SEED-003", "와인 니트 타이", 30000, "knit", "wine", "dot", "cotton"),
    ("KN-SEED-004", "그레이 니트 타이", 32000, "knit", "gray", "check", "polyester"),
    ("BT-SEED-001", "블랙 솔리드 보타이", 27000, "bowtie", "black", "solid", "silk"),
    ("BT-SEED-002", "네이비 도트 보타이", 28000, "bowtie", "navy", "dot", "cotton"),
    ("BT-SEED-003", "와인 페이즐리 보타이", 30000, "bowtie", "wine", "paisley", "wool"),
]

PRODUCTS = [
    {
        "code": code,
        "name": name,
        "price": price,
        "image": "",
        "category": category,
        "color": color,
        "pattern": pattern,
        "material": material,
        "info": "시드 상품",
        "option_label": "길이" if code in {"3F-SEED-001", "3F-SEED-002"} else None,
        "options": (
            [("일반", 0, None), ("롱", 5000, 10)]
            if code == "3F-SEED-001"
            else [("일반", 0, 3)]
            if code == "3F-SEED-002"
            else []
        ),
    }
    for code, name, price, category, color, pattern, material in PRODUCT_VARIANTS
]


def _backfill_option_label(product: Product, option_label: str | None) -> None:
    if option_label and not (product.option_label or "").strip():
        product.option_label = option_label

PLACEHOLDER_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)

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


async def _ensure_initial_tokens(session) -> None:
    """시드 고객에게 가입 지급분을 넣는다 — 가입 경로를 타지 않아 원장이 비어 있다."""
    customer_id = await session.scalar(select(User.id).where(User.email == "customer@local"))
    if customer_id is None:
        return
    if await session.scalar(select(DesignToken.id).where(DesignToken.user_id == customer_id)):
        return
    # 설정은 on_conflict_do_nothing이라 DB에 다른 값이 남아 있을 수 있다 — 실제 지급분을 찍는다.
    granted = await grant_initial_tokens(session, customer_id)
    if granted:
        print(f"  design tokens: customer@local ← {granted}")


async def _ensure_product_image(session, gcs, settings, product: Product) -> None:
    assert product.code is not None
    image = await session.scalar(
        select(Image)
        .where(
            Image.entity_type == "product_primary",
            Image.entity_id == str(product.id),
            Image.deleted_at.is_(None),
        )
        .order_by(Image.created_at, Image.id)
    )
    if image is None:
        object_key = f"products/seed/{product.code.lower()}.png"
        upload_url = await gcs.signed_upload_url(
            object_key,
            "image/png",
            bucket_name=assets_bucket_name(settings),
        )
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.put(
                upload_url,
                content=PLACEHOLDER_PNG,
                headers={"Content-Type": "image/png"},
            )
        response.raise_for_status()
        image = Image(
            object_key=object_key,
            entity_type="product_primary",
            entity_id=str(product.id),
            content_type="image/png",
            size_bytes=len(PLACEHOLDER_PNG),
            original_filename=f"{product.code.lower()}.png",
            upload_completed_at=datetime.now(timezone.utc),
        )
        session.add(image)
        print(f"  product image: {product.code}")
    product.image = public_asset_url(settings, image.object_key)


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

    terms_snapshot = {
        "name": coupon.name,
        "display_name": coupon.display_name,
        "discount_type": coupon.discount_type,
        "discount_value": str(coupon.discount_value),
        "max_discount_amount": None,
        "description": coupon.description,
        "expiry_date": coupon.expiry_date.isoformat(),
        "additional_info": coupon.additional_info,
    }
    await session.execute(
        pg_insert(UserCoupon)
        .values(
            user_id=customer_id,
            coupon_id=coupon.id,
            status="active",
            expires_at=expires_at,
            terms_snapshot=terms_snapshot,
        )
        .on_conflict_do_update(
            index_elements=[UserCoupon.user_id, UserCoupon.coupon_id],
            set_={
                "status": "active",
                "expires_at": expires_at,
                "used_at": None,
                "terms_snapshot": terms_snapshot,
            },
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
            paid_at=now,  # 매출 지표의 시간 기준 — 없으면 로컬 대시보드가 0으로 보인다
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
        paid_at=now,
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
    gcs = build_gcs_client(settings)
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
            else:
                product = existing
                _backfill_option_label(product, product_data["option_label"])
            await _ensure_product_image(session, gcs, settings, product)

        # admin_settings 이후 — grant_initial_tokens가 design_token_initial_grant를 읽는다.
        await _ensure_initial_tokens(session)
        await _ensure_test_coupon(session)
        await _ensure_admin_smoke_order(session)
        await _ensure_content_visibility_orders(session)

        await session.commit()
    await engine.dispose()
    print("seed 완료")


if __name__ == "__main__":
    asyncio.run(main())
