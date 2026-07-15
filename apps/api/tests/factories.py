"""테스트 데이터 팩토리 — 시드 최소화, 전부 실DB 커밋."""

import itertools
import uuid
from datetime import UTC, date, datetime
from typing import Any

from api.config import Settings
from api.security import create_access_token, password_hasher
from db.models.auth import User
from db.models.commerce import (
    AdminSetting,
    Claim,
    Coupon,
    Order,
    OrderItem,
    PricingConstant,
    Product,
    ShippingAddress,
    UserCoupon,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

_seq = itertools.count(1)


async def make_user(
    session: AsyncSession,
    *,
    role: str = "customer",
    name: str = "테스트유저",
    email: str | None = None,
    phone: str | None = None,
    password: str | None = None,
) -> User:
    n = next(_seq)
    user = User(
        email=email if email is not None else f"user{n}-{uuid.uuid4().hex[:6]}@test.local",
        name=name,
        role=role,
        phone=phone,
        password_hash=password_hasher.hash(password) if password else None,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def make_admin(session: AsyncSession, **kwargs) -> User:
    return await make_user(session, role="admin", name="관리자", **kwargs)


async def make_product(
    session: AsyncSession,
    *,
    name: str = "테스트 넥타이",
    price: int = 30000,
    stock: int | None = None,
    category: str = "3fold",
    color: str = "navy",
    pattern: str = "solid",
    material: str = "silk",
) -> Product:
    product = Product(
        name=name,
        price=price,
        stock=stock,
        image="https://img.test.local/p.png",
        category=category,
        color=color,
        pattern=pattern,
        material=material,
        info="테스트 상품",
    )
    session.add(product)
    await session.commit()
    await session.refresh(product)
    return product


def auth_headers(user: User, settings: Settings) -> dict[str, str]:
    session_kind = "admin" if user.role in ("admin", "manager") else "store"
    token = create_access_token(user.id, user.role, settings, session_kind=session_kind)
    return {"Authorization": f"Bearer {token}"}


async def make_address(session: AsyncSession, user: User) -> ShippingAddress:
    address = ShippingAddress(
        user_id=user.id,
        recipient_name="수령인",
        recipient_phone="01012345678",
        postal_code="04524",
        address="서울시 중구 테스트로 1",
        is_default=True,
    )
    session.add(address)
    await session.commit()
    await session.refresh(address)
    return address


async def make_order(
    session: AsyncSession,
    user: User,
    *,
    order_type: str = "sale",
    status: str = "대기중",
    total_price: int = 10000,
    created_at: datetime | None = None,
    **kwargs: Any,
) -> Order:
    n = next(_seq)
    order = Order(
        user_id=user.id,
        order_number=f"ORD-TEST-{n:06d}",  # 채번 LIKE 패턴과 안 겹치는 형식
        order_type=order_type,
        status=status,
        total_price=total_price,
        original_price=total_price,
        payment_group_id=uuid.uuid4(),
        **kwargs,
    )
    if created_at is not None:
        order.created_at = created_at
    session.add(order)
    await session.commit()
    await session.refresh(order)
    return order


async def seed_pricing(
    session: AsyncSession, values: dict[str, int], category: str = "custom_order"
) -> None:
    for key, amount in values.items():
        session.add(PricingConstant(key=key, amount=amount, category=category))
    await session.commit()


async def seed_setting(session: AsyncSession, key: str, value: str) -> None:
    await session.execute(
        pg_insert(AdminSetting)
        .values(key=key, value=value)
        .on_conflict_do_update(index_elements=[AdminSetting.key], set_={"value": value})
    )
    await session.commit()


async def make_coupon(
    session: AsyncSession,
    *,
    discount_type: str = "fixed",
    discount_value: int = 1000,
    max_discount_amount: int | None = None,
) -> Coupon:
    coupon = Coupon(
        name=f"쿠폰-{next(_seq)}",
        discount_type=discount_type,
        discount_value=discount_value,
        max_discount_amount=max_discount_amount,
        expiry_date=date(2099, 12, 31),
    )
    session.add(coupon)
    await session.commit()
    await session.refresh(coupon)
    return coupon


async def make_user_coupon(
    session: AsyncSession, user: User, coupon: Coupon, status: str = "active"
) -> UserCoupon:
    user_coupon = UserCoupon(user_id=user.id, coupon_id=coupon.id, status=status)
    session.add(user_coupon)
    await session.commit()
    await session.refresh(user_coupon)
    return user_coupon


async def make_token_refund_claim(session: AsyncSession, user: User) -> Claim:
    order = await make_order(session, user, order_type="token", status="완료")
    item = OrderItem(
        order_id=order.id,
        item_id=f"token-order-{order.id}",
        item_type="token",
        item_data={"plan_key": "starter", "token_amount": 100},
        quantity=1,
        unit_price=order.total_price,
    )
    session.add(item)
    await session.flush()
    claim = Claim(
        user_id=user.id,
        order_id=order.id,
        order_item_id=item.id,
        claim_number=f"TKR-{datetime.now(UTC):%Y%m%d%H%M%S}-{uuid.uuid4().hex[:4]}",
        type="token_refund",
        status="접수",
        reason="token_refund",
        quantity=1,
        refund_data={
            "paid_token_amount": 100,
            "bonus_token_amount": 0,
            "refund_amount": order.total_price,
        },
    )
    session.add(claim)
    await session.commit()
    await session.refresh(claim)
    return claim
