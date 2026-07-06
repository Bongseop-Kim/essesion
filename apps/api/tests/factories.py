"""테스트 데이터 팩토리 — 시드 최소화, 전부 실DB 커밋."""

import itertools
import uuid

from api.config import Settings
from api.security import create_access_token, password_hasher
from db.models.auth import User
from db.models.commerce import Product
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
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role, settings)}"}
