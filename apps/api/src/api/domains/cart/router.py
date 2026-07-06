"""장바구니 — 전체 교체 의미론(병합 아님), 유저 advisory lock으로 직렬화."""

from db.models.auth import User
from db.models.commerce import CartItem, Coupon, Product, UserCoupon
from fastapi import APIRouter
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import USER_LOCK, SessionDep, advisory_xact_lock
from api.deps import CurrentUser
from api.domains.cart.schemas import (
    CartItemIn,
    CartItemOut,
    CartRemoveRequest,
    CartReplaceRequest,
)
from api.domains.coupons.schemas import CouponOut, UserCouponOut
from api.domains.products.router import _load_options, _product_query
from api.domains.products.schemas import ProductOptionOut, ProductOut
from api.errors import DomainError

router = APIRouter(tags=["cart"])


def _validate_item(item: CartItemIn) -> None:
    if item.quantity <= 0:
        raise DomainError("Invalid item quantity", code="invalid_quantity")
    if item.item_type == "product" and (item.product_id is None or item.reform_data is not None):
        raise DomainError("Invalid product cart item", code="invalid_cart_item")
    if item.item_type == "reform" and (item.product_id is not None or item.reform_data is None):
        raise DomainError("Invalid reform cart item", code="invalid_cart_item")


async def _load_cart(session: AsyncSession, user: User) -> list[CartItemOut]:
    items = (
        await session.scalars(
            select(CartItem).where(CartItem.user_id == user.id).order_by(CartItem.created_at)
        )
    ).all()

    product_ids = [i.product_id for i in items if i.product_id is not None]
    products: dict[int, ProductOut] = {}
    if product_ids:
        rows = (
            await session.execute(_product_query(user).where(Product.id.in_(product_ids)))
        ).all()
        options = await _load_options(session, product_ids)
        for product, likes, liked in rows:
            out = ProductOut.model_validate(product)
            out.likes, out.is_liked, out.options = likes, liked, options[product.id]
            products[product.id] = out

    coupon_ids = [i.applied_user_coupon_id for i in items if i.applied_user_coupon_id]
    coupons: dict = {}
    if coupon_ids:
        rows = (
            await session.execute(
                select(UserCoupon, Coupon)
                .join(Coupon, Coupon.id == UserCoupon.coupon_id)
                .where(UserCoupon.id.in_(coupon_ids))
            )
        ).all()
        for user_coupon, coupon in rows:
            out = UserCouponOut.model_validate(user_coupon)
            out.coupon = CouponOut.model_validate(coupon)
            coupons[user_coupon.id] = out

    results = []
    for item in items:
        product = products.get(item.product_id) if item.product_id else None
        selected_option: ProductOptionOut | None = None
        if product and item.selected_option_id:
            selected_option = next(
                (o for o in product.options if str(o.id) == item.selected_option_id), None
            )
        results.append(
            CartItemOut(
                item_id=item.item_id,
                item_type=item.item_type,
                quantity=item.quantity,
                product=product,
                selected_option=selected_option,
                reform_data=item.reform_data,
                applied_coupon=coupons.get(item.applied_user_coupon_id),
            )
        )
    return results


@router.get("/cart", response_model=list[CartItemOut])
async def get_cart(session: SessionDep, user: CurrentUser) -> list[CartItemOut]:
    return await _load_cart(session, user)


@router.put("/cart", response_model=list[CartItemOut])
async def replace_cart(
    body: CartReplaceRequest, session: SessionDep, user: CurrentUser
) -> list[CartItemOut]:
    for item in body.items:
        _validate_item(item)
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user.id))
    await session.execute(delete(CartItem).where(CartItem.user_id == user.id))
    for item in body.items:
        session.add(CartItem(user_id=user.id, **item.model_dump()))
    await session.commit()
    return await _load_cart(session, user)


@router.post("/cart/remove", response_model=list[CartItemOut])
async def remove_cart_items(
    body: CartRemoveRequest, session: SessionDep, user: CurrentUser
) -> list[CartItemOut]:
    if body.item_ids:
        await session.execute(
            delete(CartItem).where(CartItem.user_id == user.id, CartItem.item_id.in_(body.item_ids))
        )
        await session.commit()
    return await _load_cart(session, user)
