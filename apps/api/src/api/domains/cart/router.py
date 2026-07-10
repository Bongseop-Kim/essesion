"""장바구니 — 전체 교체 의미론(병합 아님), 유저 advisory lock으로 직렬화."""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from db.models.auth import User
from db.models.commerce import CartItem, Coupon, Product, UserCoupon
from fastapi import APIRouter
from sqlalchemy import delete, select, update
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
from api.domains.reform.schemas import ReformDataOut
from api.domains.reform.service import claim_reform_image, get_reform_pricing, reform_snapshot
from api.errors import DomainError

router = APIRouter(tags=["cart"])
REMOVED_REFORM_IMAGE_TTL = timedelta(hours=24)


def _reform_image_keys(items: Sequence[CartItem]) -> set[str]:
    keys: set[str] = set()
    for item in items:
        data = item.reform_data
        if not isinstance(data, dict):
            continue
        image = (data.get("tie") or {}).get("image") or {}
        key = image.get("object_key")
        if isinstance(key, str):
            keys.add(key)
    return keys


async def _expire_removed_images(
    session: AsyncSession, user: User, removed_keys: set[str]
) -> None:
    if not removed_keys:
        return
    from db.models.images import Image

    await session.execute(
        update(Image)
        .where(
            Image.entity_type == "reform_upload",
            Image.uploaded_by == user.id,
            Image.object_key.in_(removed_keys),
        )
        .values(expires_at=datetime.now(UTC) + REMOVED_REFORM_IMAGE_TTL)
    )


def _validate_item(item: CartItemIn) -> None:
    if item.quantity <= 0:
        raise DomainError("Invalid item quantity", code="invalid_quantity")
    if item.item_type == "product" and (item.product_id is None or item.reform_data is not None):
        raise DomainError("Invalid product cart item", code="invalid_cart_item")
    if item.item_type == "reform" and (item.product_id is not None or item.reform_data is None):
        raise DomainError("Invalid reform cart item", code="invalid_cart_item")
    if item.item_type == "reform" and item.quantity != 1:
        raise DomainError("Reform item quantity must be one", code="invalid_quantity")


async def _load_cart(session: AsyncSession, user: User) -> list[CartItemOut]:
    items = (
        await session.scalars(
            select(CartItem).where(CartItem.user_id == user.id).order_by(CartItem.created_at)
        )
    ).all()

    product_ids = [i.product_id for i in items if i.product_id is not None]
    products: dict[int, ProductOut] = {}
    if product_ids:
        product_query, _ = _product_query(user)
        rows = (await session.execute(product_query.where(Product.id.in_(product_ids)))).all()
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
                reform_data=(
                    ReformDataOut.model_validate(item.reform_data)
                    if item.reform_data is not None
                    else None
                ),
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
    previous_items = (
        await session.scalars(select(CartItem).where(CartItem.user_id == user.id))
    ).all()
    previous_image_keys = _reform_image_keys(previous_items)
    await session.execute(delete(CartItem).where(CartItem.user_id == user.id))
    reform_pricing = (
        await get_reform_pricing(session)
        if any(item.item_type == "reform" for item in body.items)
        else None
    )
    for item in body.items:
        values = item.model_dump()
        if item.item_type == "reform":
            assert item.reform_data is not None and reform_pricing is not None
            await claim_reform_image(
                session, user.id, item.reform_data.tie.image
            )
            values["reform_data"] = reform_snapshot(
                item.reform_data, reform_pricing
            ).model_dump()
        session.add(CartItem(user_id=user.id, **values))
    next_image_keys = {
        item.reform_data.tie.image.object_key
        for item in body.items
        if item.item_type == "reform" and item.reform_data is not None
    }
    await _expire_removed_images(session, user, previous_image_keys - next_image_keys)
    await session.commit()
    return await _load_cart(session, user)


@router.post("/cart/remove", response_model=list[CartItemOut])
async def remove_cart_items(
    body: CartRemoveRequest, session: SessionDep, user: CurrentUser
) -> list[CartItemOut]:
    if body.item_ids:
        await advisory_xact_lock(session, USER_LOCK.format(user_id=user.id))
        removed_items = (
            await session.scalars(
                select(CartItem).where(
                    CartItem.user_id == user.id,
                    CartItem.item_id.in_(body.item_ids),
                )
            )
        ).all()
        await session.execute(
            delete(CartItem).where(CartItem.user_id == user.id, CartItem.item_id.in_(body.item_ids))
        )
        await _expire_removed_images(session, user, _reform_image_keys(removed_items))
        await session.commit()
    return await _load_cart(session, user)
