"""상품 — 공개 조회 + 찜(본인만 쓰기) + 관리자 CRUD (인가 규칙 ①)."""

from collections import defaultdict
from typing import Annotated

from db.models.auth import User
from db.models.commerce import Product, ProductLike, ProductOption
from fastapi import APIRouter, Query
from sqlalchemy import delete, exists, false, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import SessionDep
from api.deps import AdminUser, CurrentUser, OptionalUser
from api.domains.products.schemas import (
    Category,
    Color,
    Material,
    Pattern,
    ProductCreate,
    ProductOptionIn,
    ProductOptionOut,
    ProductOut,
    ProductUpdate,
    SortOption,
)
from api.errors import NotFoundError
from api.numbering import generate_number

router = APIRouter(tags=["products"])

CODE_PREFIX = {"3fold": "3F", "sfolderato": "SF", "knit": "KN", "bowtie": "BT"}


def _likes_subquery():
    """상품별 찜 수 (상관 스칼라 서브쿼리) — SELECT 라벨과 popular 정렬에서 재사용."""
    return (
        select(func.count())
        .where(ProductLike.product_id == Product.id)
        .correlate(Product)
        .scalar_subquery()
    )


def _product_query(user: User | None):
    likes = _likes_subquery()
    if user is not None:
        is_liked = exists().where(
            ProductLike.product_id == Product.id, ProductLike.user_id == user.id
        )
    else:
        is_liked = false()
    return select(Product, likes.label("likes"), is_liked.label("is_liked")), likes


async def _load_options(session: AsyncSession, product_ids: list[int]) -> dict[int, list]:
    options: dict[int, list] = defaultdict(list)
    if not product_ids:
        return options
    rows = await session.scalars(
        select(ProductOption)
        .where(ProductOption.product_id.in_(product_ids))
        .order_by(ProductOption.created_at, ProductOption.id)
    )
    for option in rows:
        options[option.product_id].append(ProductOptionOut.model_validate(option))
    return options


def _to_out(product: Product, likes: int, is_liked: bool, options: list) -> ProductOut:
    out = ProductOut.model_validate(product)
    out.likes = likes
    out.is_liked = is_liked
    out.options = options
    return out


@router.get("/products", response_model=list[ProductOut])
async def list_products(
    session: SessionDep,
    user: OptionalUser,
    category: Category | None = None,
    color: Color | None = None,
    pattern: Pattern | None = None,
    material: Material | None = None,
    sort: SortOption = "latest",
    limit: Annotated[int | None, Query(gt=0, le=100)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ProductOut]:
    query, likes = _product_query(user)
    if category:
        query = query.where(Product.category == category)
    if color:
        query = query.where(Product.color == color)
    if pattern:
        query = query.where(Product.pattern == pattern)
    if material:
        query = query.where(Product.material == material)
    order_by = {
        "latest": [Product.id.desc()],
        "price-low": [Product.price.asc(), Product.id.desc()],
        "price-high": [Product.price.desc(), Product.id.desc()],
        "popular": [likes.desc(), Product.id.desc()],
    }[sort]
    query = query.order_by(*order_by)
    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    rows = (await session.execute(query)).all()
    options = await _load_options(session, [p.id for p, _, _ in rows])
    return [_to_out(p, likes, liked, options[p.id]) for p, likes, liked in rows]


@router.get("/products/{product_id}", response_model=ProductOut)
async def get_product(product_id: int, session: SessionDep, user: OptionalUser) -> ProductOut:
    query, _ = _product_query(user)
    row = (await session.execute(query.where(Product.id == product_id))).first()
    if row is None:
        raise NotFoundError("상품을 찾을 수 없습니다")
    product, likes, liked = row
    options = await _load_options(session, [product.id])
    return _to_out(product, likes, liked, options[product.id])


@router.put("/products/{product_id}/like", status_code=204)
async def like_product(product_id: int, session: SessionDep, user: CurrentUser) -> None:
    if await session.get(Product, product_id) is None:
        raise NotFoundError("상품을 찾을 수 없습니다")
    await session.execute(
        pg_insert(ProductLike)
        .values(user_id=user.id, product_id=product_id)
        .on_conflict_do_nothing(index_elements=["user_id", "product_id"])
    )
    await session.commit()


@router.delete("/products/{product_id}/like", status_code=204)
async def unlike_product(product_id: int, session: SessionDep, user: CurrentUser) -> None:
    await session.execute(
        delete(ProductLike).where(
            ProductLike.user_id == user.id, ProductLike.product_id == product_id
        )
    )
    await session.commit()


# ---- 관리자 ----


@router.post("/admin/products", response_model=ProductOut, status_code=201)
async def create_product(body: ProductCreate, session: SessionDep, admin: AdminUser) -> ProductOut:
    code = body.code
    if not code:
        prefix = CODE_PREFIX.get(body.category, "XX")
        code = await generate_number(session, Product.code, prefix)
    product = Product(**body.model_dump(exclude={"code"}), code=code)
    session.add(product)
    await session.commit()
    await session.refresh(product)
    return _to_out(product, 0, False, [])


@router.patch("/admin/products/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: int, body: ProductUpdate, session: SessionDep, admin: AdminUser
) -> ProductOut:
    product = await session.get(Product, product_id)
    if product is None:
        raise NotFoundError("상품을 찾을 수 없습니다")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    await session.commit()
    await session.refresh(product)
    options = await _load_options(session, [product.id])
    return _to_out(product, 0, False, options[product.id])


@router.put("/admin/products/{product_id}/options", response_model=list[ProductOptionOut])
async def replace_product_options(
    product_id: int, body: list[ProductOptionIn], session: SessionDep, admin: AdminUser
) -> list[ProductOptionOut]:
    """전체 교체. 옵션이 1개 이상이면 상품 재고는 NULL로 강제(옵션별 재고 관리 전환)."""
    product = await session.get(Product, product_id)
    if product is None:
        raise NotFoundError("상품을 찾을 수 없습니다")
    await session.execute(delete(ProductOption).where(ProductOption.product_id == product_id))
    for option in body:
        session.add(ProductOption(product_id=product_id, **option.model_dump()))
    if body:
        product.stock = None
    await session.commit()
    rows = await session.scalars(
        select(ProductOption)
        .where(ProductOption.product_id == product_id)
        .order_by(ProductOption.created_at, ProductOption.id)
    )
    return [ProductOptionOut.model_validate(o) for o in rows]
