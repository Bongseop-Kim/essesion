"""주문 생성 3종·구매확정·수선 발송 — docs/api-spec/money.md §2~§4·§7.

수식·검증·상태 문자열은 기존 시스템 명세 그대로. 오류 메시지도 원문(영/한) 보존.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, cast

from db.models.auth import User
from db.models.commerce import (
    Claim,
    Coupon,
    Order,
    OrderItem,
    OrderStatusLog,
    Product,
    ProductOption,
    RepairPickupRequest,
    RepairShippingReceipt,
    ShippingAddress,
    UserCoupon,
)
from db.models.images import Image
from sqlalchemy import CursorResult, exists, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.domains.orders.schemas import (
    CustomOrderCreateRequest,
    OrderCreateRequest,
    OrderItemIn,
    RepairNoTrackingRequest,
    RepairTrackingRequest,
    SampleOrderCreateRequest,
)
from api.domains.orders.status_machine import ACTIVE_CLAIM_STATUSES
from api.domains.reform.schemas import ReformPricingOut
from api.domains.reform.service import claim_reform_image, get_reform_pricing, reform_snapshot
from api.errors import DomainError, ForbiddenError, NotFoundError
from api.numbering import generate_number
from api.pricing import get_pricing_constants

MAX_ITEMS = 50

CUSTOM_PRICING_KEYS = [
    "START_COST",
    "SEWING_PER_COST",
    "AUTO_TIE_COST",
    "TRIANGLE_STITCH_COST",
    "SIDE_STITCH_COST",
    "BAR_TACK_COST",
    "DIMPLE_COST",
    "SPODERATO_COST",
    "FOLD7_COST",
    "WOOL_INTERLINING_COST",
    "BRAND_LABEL_COST",
    "CARE_LABEL_COST",
    "YARN_DYED_DESIGN_COST",
]

SAMPLE_PRICING_KEY = {
    ("sewing", None): "SAMPLE_SEWING_COST",
    ("fabric", "PRINTING"): "SAMPLE_FABRIC_PRINTING_COST",
    ("fabric", "YARN_DYED"): "SAMPLE_FABRIC_YARN_DYED_COST",
    ("fabric_and_sewing", "PRINTING"): "SAMPLE_FABRIC_AND_SEWING_PRINTING_COST",
    ("fabric_and_sewing", "YARN_DYED"): "SAMPLE_FABRIC_AND_SEWING_YARN_DYED_COST",
}


async def has_active_claim(session: AsyncSession, order_id: uuid.UUID) -> bool:
    return bool(
        await session.scalar(
            select(
                exists().where(Claim.order_id == order_id, Claim.status.in_(ACTIVE_CLAIM_STATUSES))
            )
        )
    )


def log_status(
    session: AsyncSession,
    order: Order,
    new_status: str,
    *,
    changed_by: uuid.UUID | None,
    memo: str | None = None,
    is_rollback: bool = False,
) -> None:
    session.add(
        OrderStatusLog(
            order_id=order.id,
            changed_by=changed_by,
            previous_status=order.status,
            new_status=new_status,
            memo=memo,
            is_rollback=is_rollback,
        )
    )
    order.status = new_status


async def _get_owned_address(
    session: AsyncSession, user: User, address_id: uuid.UUID
) -> ShippingAddress:
    address = await session.scalar(
        select(ShippingAddress).where(
            ShippingAddress.id == address_id, ShippingAddress.user_id == user.id
        )
    )
    if address is None:
        raise DomainError("Shipping address not found", code="address_not_found", status=404)
    return address


@dataclass
class _CouponApplication:
    unit_discount: int = 0
    line_total: int = 0


async def apply_coupon(
    session: AsyncSession,
    user_id: uuid.UUID,
    user_coupon_id: uuid.UUID,
    unit_price: int,
    quantity: int,
    used: set[uuid.UUID],
) -> _CouponApplication:
    """쿠폰 라인 할인 — 라인 계산·캡 → 단위 재분배 (money.md §2)."""
    if user_coupon_id in used:
        raise DomainError("Coupon can only be applied once per order", code="coupon_duplicate")
    used.add(user_coupon_id)

    row = (
        await session.execute(
            select(UserCoupon, Coupon)
            .join(Coupon, Coupon.id == UserCoupon.coupon_id)
            .where(UserCoupon.id == user_coupon_id, UserCoupon.user_id == user_id)
            .with_for_update(of=UserCoupon)
        )
    ).first()
    if row is None:
        raise DomainError("Coupon not found", code="coupon_not_found", status=404)
    user_coupon, coupon = row

    if user_coupon.status != "active":
        raise DomainError("Coupon is not available", code="coupon_unavailable")
    if user_coupon.expires_at is not None and user_coupon.expires_at <= datetime.now(UTC):
        raise DomainError("Coupon has expired", code="coupon_expired")
    if not coupon.is_active:
        raise DomainError("Coupon is not active", code="coupon_inactive")
    if coupon.expiry_date < datetime.now(UTC).date():
        raise DomainError("Coupon has expired", code="coupon_expired")

    line_amount = unit_price * quantity
    if coupon.discount_type == "percentage":
        line_discount = int(line_amount * coupon.discount_value / 100)
    elif coupon.discount_type == "fixed":
        line_discount = int(coupon.discount_value)
    else:
        raise DomainError("Invalid coupon type", code="coupon_invalid")

    capped_line = max(0, min(line_discount, line_amount))
    if coupon.max_discount_amount is not None:
        capped_line = min(capped_line, int(coupon.max_discount_amount))
    return _CouponApplication(unit_discount=capped_line // quantity, line_total=capped_line)


async def _reserve_coupons(
    session: AsyncSession, user_id: uuid.UUID, coupon_ids: set[uuid.UUID]
) -> None:
    if coupon_ids:
        await session.execute(
            update(UserCoupon)
            .where(
                UserCoupon.user_id == user_id,
                UserCoupon.status == "active",
                UserCoupon.id.in_(coupon_ids),
            )
            .values(status="reserved")
        )


async def order_coupon_ids(
    session: AsyncSession, order_ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    rows = await session.scalars(
        select(OrderItem.applied_user_coupon_id).where(
            OrderItem.order_id.in_(order_ids),
            OrderItem.applied_user_coupon_id.isnot(None),
        )
    )
    return list({coupon_id for coupon_id in rows if coupon_id is not None})


async def restore_reserved_order_coupons(
    session: AsyncSession, orders: Sequence[Order]
) -> None:
    order_ids_by_user: dict[uuid.UUID, list[uuid.UUID]] = {}
    for order in orders:
        order_ids_by_user.setdefault(order.user_id, []).append(order.id)
    for user_id, order_ids in order_ids_by_user.items():
        coupon_ids = await order_coupon_ids(session, order_ids)
        if coupon_ids:
            await session.execute(
                update(UserCoupon)
                .where(
                    UserCoupon.user_id == user_id,
                    UserCoupon.status == "reserved",
                    UserCoupon.id.in_(coupon_ids),
                )
                .values(status="active")
            )


def _register_images(
    session: AsyncSession,
    user_id: uuid.UUID,
    entity_type: str,
    entity_id: str,
    object_keys: list[str],
) -> None:
    for key in object_keys:
        session.add(
            Image(object_key=key, entity_type=entity_type, entity_id=entity_id, uploaded_by=user_id)
        )


async def _relink_images(
    session: AsyncSession,
    user_id: uuid.UUID,
    from_entity_type: str,
    file_key: str,
    to_entity_type: str,
    to_entity_id: str,
) -> int:
    result = await session.execute(
        update(Image)
        .where(
            Image.entity_type == from_entity_type,
            Image.entity_id == file_key,
            Image.uploaded_by == user_id,
            Image.deleted_at.is_(None),
        )
        .values(entity_type=to_entity_type, entity_id=to_entity_id)
    )
    return cast("CursorResult[Any]", result).rowcount


# ---- 일반 주문 (sale/repair) ----


@dataclass
class _Line:
    item: OrderItemIn
    unit_price: int
    unit_discount: int = 0
    line_discount: int = 0
    reform_data: dict | None = field(default=None)


async def _deduct_stock(session: AsyncSession, item: OrderItemIn) -> int:
    """재고 FOR UPDATE 차감(결제 전, NULL=무제한 — 원 동작). 반환 = 단가."""
    product = await session.scalar(
        select(Product).where(Product.id == item.product_id).with_for_update()
    )
    if product is None:
        raise DomainError("Product not found", code="product_not_found", status=404)

    if item.selected_option_id:
        option = await session.scalar(
            select(ProductOption)
            .where(
                ProductOption.id == uuid.UUID(item.selected_option_id),
                ProductOption.product_id == product.id,
            )
            .with_for_update()
        )
        if option is None:
            raise DomainError("Product option not found", code="option_not_found", status=404)
        if option.stock is not None:
            if option.stock < item.quantity:
                raise DomainError("Insufficient stock for option", code="insufficient_stock")
            option.stock -= item.quantity
        return product.price + option.additional_price

    if product.stock is not None:
        if product.stock < item.quantity:
            raise DomainError("Insufficient stock", code="insufficient_stock")
        product.stock -= item.quantity
    return product.price


async def create_order(session: AsyncSession, user: User, body: OrderCreateRequest) -> dict:
    if not body.items:
        raise DomainError("Order items are required", code="items_required")
    if len(body.items) > MAX_ITEMS:
        raise DomainError("Too many items", code="too_many_items")
    await _get_owned_address(session, user, body.shipping_address_id)

    method = body.repair_shipping.method if body.repair_shipping else None

    product_lines: list[_Line] = []
    reform_lines: list[_Line] = []
    used_coupons: set[uuid.UUID] = set()
    reform_pricing: ReformPricingOut | None = None

    for item in body.items:
        if not item.item_id:
            raise DomainError("Invalid item id", code="invalid_item")
        if item.quantity <= 0:
            raise DomainError("Invalid item quantity", code="invalid_quantity")

        if item.item_type == "product":
            if item.product_id is None:
                raise DomainError("Product id is required", code="invalid_item")
            unit_price = await _deduct_stock(session, item)
            line = _Line(item=item, unit_price=unit_price)
            product_lines.append(line)
        else:
            if item.reform_data is None:
                raise DomainError("Reform data is required", code="invalid_item")
            if item.quantity != 1:
                raise DomainError("Reform item quantity must be one", code="invalid_quantity")
            if reform_pricing is None:
                reform_pricing = await get_reform_pricing(session)
            await claim_reform_image(session, user.id, item.reform_data.tie.image)
            snapshot = reform_snapshot(item.reform_data, reform_pricing)
            unit_price = snapshot.cost
            line = _Line(
                item=item,
                unit_price=unit_price,
                reform_data=snapshot.model_dump(),
            )
            reform_lines.append(line)

        if item.applied_user_coupon_id is not None:
            applied = await apply_coupon(
                session,
                user.id,
                item.applied_user_coupon_id,
                line.unit_price,
                item.quantity,
                used_coupons,
            )
            line.unit_discount = applied.unit_discount
            line.line_discount = applied.line_total

    if method == "pickup" and not reform_lines:
        raise DomainError("Pickup is only available for repair orders", code="invalid_pickup")

    payment_group_id = uuid.uuid4()
    created: list[Order] = []

    if product_lines:
        created.append(
            await _create_group_order(
                session, user, body, product_lines, "sale", payment_group_id, shipping_cost=0
            )
        )

    if reform_lines:
        assert reform_pricing is not None
        shipping_cost = reform_pricing.shipping_cost
        pickup_fee = 0
        pickup = body.repair_shipping.pickup if body.repair_shipping else None
        if method == "pickup":
            if pickup is None:
                raise DomainError("Pickup info is required", code="invalid_pickup")
            if not (
                pickup.recipient_name.strip()
                and pickup.recipient_phone.strip()
                and pickup.address.strip()
            ):
                raise DomainError(
                    "Pickup recipient name, phone and address are required", code="invalid_pickup"
                )
            pickup_fee = reform_pricing.pickup_fee
        order = await _create_group_order(
            session,
            user,
            body,
            reform_lines,
            "repair",
            payment_group_id,
            shipping_cost=shipping_cost,
            extra_fee=pickup_fee,
        )
        if method == "pickup" and pickup is not None:
            session.add(
                RepairPickupRequest(
                    order_id=order.id,
                    recipient_name=pickup.recipient_name,
                    recipient_phone=pickup.recipient_phone,
                    postal_code=pickup.postal_code,
                    address=pickup.address,
                    detail_address=pickup.detail_address,
                    pickup_fee=pickup_fee,
                )
            )
        await _relink_reform_images(session, user, reform_lines, order)
        created.append(order)

    await _reserve_coupons(session, user.id, used_coupons)
    await session.commit()

    return {
        "payment_group_id": payment_group_id,
        "total_amount": sum(o.total_price for o in created),
        "orders": [
            {"order_id": o.id, "order_number": o.order_number, "order_type": o.order_type}
            for o in created
        ],
    }


async def _create_group_order(
    session: AsyncSession,
    user: User,
    body: OrderCreateRequest,
    lines: list[_Line],
    order_type: str,
    payment_group_id: uuid.UUID,
    *,
    shipping_cost: int,
    extra_fee: int = 0,
) -> Order:
    original = sum(line.unit_price * line.item.quantity for line in lines)
    discount = sum(line.line_discount for line in lines)
    order = Order(
        user_id=user.id,
        order_number=await generate_number(session, Order.order_number, "ORD"),
        order_type=order_type,
        status="대기중",
        shipping_address_id=body.shipping_address_id,
        original_price=original,
        total_discount=discount,
        shipping_cost=shipping_cost,
        total_price=original - discount + shipping_cost + extra_fee,
        payment_group_id=payment_group_id,
    )
    session.add(order)
    await session.flush()
    for line in lines:
        session.add(
            OrderItem(
                order_id=order.id,
                item_id=line.item.item_id,
                item_type=line.item.item_type,
                product_id=line.item.product_id,
                selected_option_id=line.item.selected_option_id,
                item_data=line.reform_data,
                quantity=line.item.quantity,
                unit_price=line.unit_price,
                discount_amount=line.unit_discount,
                line_discount_amount=line.line_discount,
                applied_user_coupon_id=line.item.applied_user_coupon_id,
            )
        )
    return order


async def _relink_reform_images(
    session: AsyncSession, user: User, lines: list[_Line], order: Order
) -> None:
    for line in lines:
        tie = (line.reform_data or {}).get("tie") or {}
        image = tie.get("image") or {}
        file_key = image.get("object_key")
        if not file_key:
            raise DomainError("수선 사진이 필요합니다", code="invalid_reform_image")
        moved = await _relink_images(
            session, user.id, "reform_upload", file_key, "reform", str(order.id)
        )
        if moved == 0:
            raise DomainError("Reform image not found or not owned", code="invalid_reform_image")


# ---- 맞춤 주문 (custom) ----


async def calculate_custom_amounts(
    session: AsyncSession, options: dict, quantity: int
) -> dict[str, int]:
    if quantity <= 0:
        raise DomainError("Invalid quantity", code="invalid_quantity")
    constants = await get_pricing_constants(session, CUSTOM_PRICING_KEYS)

    tie_type = options.get("tie_type") or ""
    interlining = options.get("interlining") or ""
    if tie_type not in ("", "AUTO"):
        raise DomainError("Invalid tie_type option", code="invalid_options")
    if interlining not in ("", "WOOL"):
        raise DomainError("Invalid interlining option", code="invalid_options")
    if options.get("dimple") and tie_type != "AUTO":
        raise DomainError("딤플은 자동 봉제(AUTO)에서만 선택 가능합니다", code="invalid_options")

    sewing_per_unit = constants["SEWING_PER_COST"]
    sewing_per_unit += constants["AUTO_TIE_COST"] if tie_type == "AUTO" else 0
    for flag, key in (
        ("triangle_stitch", "TRIANGLE_STITCH_COST"),
        ("side_stitch", "SIDE_STITCH_COST"),
        ("bar_tack", "BAR_TACK_COST"),
        ("dimple", "DIMPLE_COST"),
        ("spoderato", "SPODERATO_COST"),
        ("fold7", "FOLD7_COST"),
        ("brand_label", "BRAND_LABEL_COST"),
        ("care_label", "CARE_LABEL_COST"),
    ):
        if options.get(flag):
            sewing_per_unit += constants[key]
    if interlining == "WOOL":
        sewing_per_unit += constants["WOOL_INTERLINING_COST"]
    sewing_cost = sewing_per_unit * quantity + constants["START_COST"]

    if options.get("fabric_provided"):
        fabric_cost = 0
    else:
        design_type, fabric_type = options.get("design_type"), options.get("fabric_type")
        if not design_type or not fabric_type:
            raise DomainError(
                "fabric_provided=false이지만 design_type 또는 fabric_type이 null입니다",
                code="invalid_options",
            )
        fabric_key = f"FABRIC_{design_type}_{fabric_type}"
        try:
            unit_fabric = (await get_pricing_constants(session, [fabric_key]))[fabric_key]
        except DomainError as exc:
            raise DomainError(
                "Unsupported design/fabric option for custom order pricing",
                code="invalid_options",
            ) from exc
        # round-half-up (PG round와 동일) — 원단은 수량/4 단위 환산
        fabric_cost = (quantity * unit_fabric + 2) // 4
        if design_type == "YARN_DYED":
            fabric_cost += constants["YARN_DYED_DESIGN_COST"]

    return {
        "sewing_cost": sewing_cost,
        "fabric_cost": fabric_cost,
        "total_cost": sewing_cost + fabric_cost,
    }


async def create_custom_order(
    session: AsyncSession, user: User, body: CustomOrderCreateRequest
) -> dict:
    await _get_owned_address(session, user, body.shipping_address_id)
    amounts = await calculate_custom_amounts(session, body.options, body.quantity)
    total_cost = amounts["total_cost"]
    base_unit = total_cost // body.quantity
    remainder = total_cost - base_unit * body.quantity

    line_discount = 0
    unit_discount = 0
    if body.user_coupon_id is not None:
        applied = await apply_coupon(
            session, user.id, body.user_coupon_id, base_unit, body.quantity, set()
        )
        unit_discount, line_discount = applied.unit_discount, applied.line_total

    order = Order(
        user_id=user.id,
        order_number=await generate_number(session, Order.order_number, "ORD"),
        order_type="custom",
        status="대기중",
        shipping_address_id=body.shipping_address_id,
        original_price=total_cost,
        total_discount=line_discount,
        total_price=total_cost - line_discount,
        payment_group_id=uuid.uuid4(),
    )
    session.add(order)
    await session.flush()

    reference_images = [img.model_dump() for img in body.reference_images]
    session.add(
        OrderItem(
            order_id=order.id,
            item_id=f"custom-order-{order.id}",
            item_type="custom",
            item_data={
                "custom_order": True,
                "quantity": body.quantity,
                "options": body.options,
                "reference_images": reference_images,
                "additional_notes": body.additional_notes,
                "pricing": {**amounts, "unit_price_remainder": remainder},
            },
            quantity=body.quantity,
            unit_price=base_unit,
            discount_amount=unit_discount,
            line_discount_amount=line_discount,
            applied_user_coupon_id=body.user_coupon_id,
        )
    )
    _register_images(
        session,
        user.id,
        "custom_order",
        str(order.id),
        [i.object_key for i in body.reference_images],
    )
    if body.user_coupon_id is not None:
        await _reserve_coupons(session, user.id, {body.user_coupon_id})
    await session.commit()
    return {
        "order_id": order.id,
        "order_number": order.order_number,
        "payment_group_id": order.payment_group_id,
        "total_amount": order.total_price,
    }


# ---- 샘플 주문 (sample) ----


def sample_pricing_key(sample_type: str, design_type: str | None) -> str:
    if sample_type == "sewing":
        return SAMPLE_PRICING_KEY[("sewing", None)]
    if design_type not in ("PRINTING", "YARN_DYED"):
        raise DomainError("Invalid design_type for sample order", code="invalid_options")
    return SAMPLE_PRICING_KEY[(sample_type, design_type)]


async def create_sample_order(
    session: AsyncSession, user: User, body: SampleOrderCreateRequest
) -> dict:
    await _get_owned_address(session, user, body.shipping_address_id)
    design_type = body.options.get("design_type")
    key = sample_pricing_key(body.sample_type, design_type)
    try:
        total_cost = (await get_pricing_constants(session, [key]))[key]
    except DomainError as exc:
        raise DomainError(
            "Sample pricing constant is not configured", code="pricing_not_configured"
        ) from exc

    line_discount = 0
    unit_discount = 0
    if body.user_coupon_id is not None:
        applied = await apply_coupon(session, user.id, body.user_coupon_id, total_cost, 1, set())
        unit_discount, line_discount = applied.unit_discount, applied.line_total

    order = Order(
        user_id=user.id,
        order_number=await generate_number(session, Order.order_number, "ORD"),
        order_type="sample",
        status="대기중",
        shipping_address_id=body.shipping_address_id,
        original_price=total_cost,
        total_discount=line_discount,
        total_price=total_cost - line_discount,
        payment_group_id=uuid.uuid4(),
    )
    session.add(order)
    await session.flush()
    session.add(
        OrderItem(
            order_id=order.id,
            item_id=f"sample-order-{order.id}",
            item_type="sample",
            item_data={
                "sample_type": body.sample_type,
                "options": body.options,
                "reference_images": [img.model_dump() for img in body.reference_images],
                "additional_notes": body.additional_notes,
                "pricing": {"total_cost": total_cost},
            },
            quantity=1,
            unit_price=total_cost,
            discount_amount=unit_discount,
            line_discount_amount=line_discount,
            applied_user_coupon_id=body.user_coupon_id,
        )
    )
    _register_images(
        session,
        user.id,
        "sample_order",
        str(order.id),
        [i.object_key for i in body.reference_images],
    )
    if body.user_coupon_id is not None:
        await _reserve_coupons(session, user.id, {body.user_coupon_id})
    await session.commit()
    return {
        "order_id": order.id,
        "order_number": order.order_number,
        "payment_group_id": order.payment_group_id,
        "total_amount": order.total_price,
    }


# ---- 구매 확정 / 수선 발송 ----


async def get_owned_order_for_update(
    session: AsyncSession, user: User, order_id: uuid.UUID
) -> Order:
    order = await session.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None:
        raise NotFoundError("주문을 찾을 수 없습니다")
    if order.user_id != user.id and user.role not in ("admin", "manager"):
        raise ForbiddenError()
    return order


async def confirm_purchase(session: AsyncSession, user: User, order_id: uuid.UUID) -> Order:
    order = await get_owned_order_for_update(session, user, order_id)
    if order.status not in ("배송완료", "배송중"):
        raise DomainError("현재 주문 상태에서는 구매확정할 수 없습니다", code="invalid_status")
    if await has_active_claim(session, order.id):
        raise DomainError(
            "진행 중인 클레임이 있는 주문은 구매확정할 수 없습니다", code="active_claim"
        )
    log_status(session, order, "완료", changed_by=user.id, memo="고객 직접 구매확정")
    order.confirmed_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(order)  # onupdate 컬럼(updated_at) 만료 해소
    return order


COURIER_CODE_MAX = 30


async def submit_repair_tracking(
    session: AsyncSession, user: User, order_id: uuid.UUID, body: RepairTrackingRequest
) -> Order:
    code = body.courier_company.strip().lower()
    if not code:
        raise DomainError("택배사를 선택해주세요", code="invalid_courier")
    if not code.replace("-", "").replace("_", "").isalnum() or len(code) > COURIER_CODE_MAX:
        raise DomainError(f"올바르지 않은 택배사 코드입니다: {code}", code="invalid_courier")
    if not body.tracking_number.strip():
        raise DomainError("송장번호를 입력해주세요", code="invalid_tracking")
    if len(body.photos) > 3:
        raise DomainError("발송 사진은 최대 3장까지 등록할 수 있습니다", code="too_many_photos")

    order = await get_owned_order_for_update(session, user, order_id)
    if order.status != "발송대기":
        raise DomainError(
            f"발송대기 상태에서만 송장번호를 등록할 수 있습니다 (현재 상태: {order.status})",
            code="invalid_status",
        )
    log_status(
        session,
        order,
        "발송중",
        changed_by=user.id,
        memo=f"고객 발송 처리: {code} {body.tracking_number.strip()}",
    )
    order.courier_company = code
    order.tracking_number = body.tracking_number.strip()
    order.shipped_at = datetime.now(UTC)
    await _relink_repair_photos(session, user, order, [p.object_key for p in body.photos])
    session.add(
        RepairShippingReceipt(
            order_id=order.id,
            receipt_type="tracking",
            photos=[{"object_key": p.object_key} for p in body.photos],
        )
    )
    await session.commit()
    await session.refresh(order)
    return order


async def submit_repair_no_tracking(
    session: AsyncSession, user: User, order_id: uuid.UUID, body: RepairNoTrackingRequest
) -> Order:
    if body.memo and len(body.memo) > 500:
        raise DomainError("메모는 500자 이내로 입력해주세요", code="memo_too_long")
    if len(body.photos) > 3:
        raise DomainError("발송 사진은 최대 3장까지 등록할 수 있습니다", code="too_many_photos")

    order = await get_owned_order_for_update(session, user, order_id)
    if order.status != "발송대기":
        raise DomainError(
            f"발송대기 상태에서만 송장번호를 등록할 수 있습니다 (현재 상태: {order.status})",
            code="invalid_status",
        )
    log_status(
        session,
        order,
        "발송확인중",
        changed_by=user.id,
        memo=f"고객 송장 없는 발송 접수: {body.reason}",
    )
    order.shipped_at = datetime.now(UTC)
    await _relink_repair_photos(session, user, order, [p.object_key for p in body.photos])
    session.add(
        RepairShippingReceipt(
            order_id=order.id,
            receipt_type="no_tracking",
            reason=body.reason,
            memo=body.memo,
            photos=[{"object_key": p.object_key} for p in body.photos],
        )
    )
    await session.commit()
    await session.refresh(order)
    return order


async def _relink_repair_photos(
    session: AsyncSession, user: User, order: Order, object_keys: list[str]
) -> None:
    for key in object_keys:
        moved = await _relink_images(
            session, user.id, "repair_shipping_upload", key, "repair_shipping", str(order.id)
        )
        if moved == 0:
            raise DomainError("Repair shipping photo not found or not owned", code="invalid_photo")


# ---- 관리자 상태 변경 / 송장 ----


async def repair_previous_status(session: AsyncSession, order: Order) -> str:
    """repair 접수 롤백 대상 — pickup? 수거예정 / no_tracking 영수증? 발송확인중 / else 발송중."""
    if await session.scalar(select(exists().where(RepairPickupRequest.order_id == order.id))):
        return "수거예정"
    if await session.scalar(
        select(
            exists().where(
                RepairShippingReceipt.order_id == order.id,
                RepairShippingReceipt.receipt_type == "no_tracking",
            )
        )
    ):
        return "발송확인중"
    return "발송중"


async def admin_update_status(
    session: AsyncSession,
    admin: User,
    order_id: uuid.UUID,
    new_status: str,
    memo: str | None,
    is_rollback: bool,
) -> dict:
    from api.domains.orders.status_machine import validate_transition

    order = await session.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None:
        raise NotFoundError(f"Order not found: {order_id}")
    if await has_active_claim(session, order.id):
        raise DomainError(
            "활성 클레임이 있는 주문은 주문 상태를 직접 변경할 수 없습니다", code="active_claim"
        )
    if not new_status:
        raise DomainError("Invalid status", code="invalid_status")
    if is_rollback and not (memo and memo.strip()):
        raise DomainError("롤백 시 사유 입력 필수", code="memo_required")

    repair_prev = None
    if is_rollback and order.order_type == "repair" and order.status == "접수":
        repair_prev = await repair_previous_status(session, order)
    validate_transition(
        order.order_type,
        order.status,
        new_status,
        is_rollback=is_rollback,
        repair_previous=repair_prev,
    )
    previous = order.status
    log_status(session, order, new_status, changed_by=admin.id, memo=memo, is_rollback=is_rollback)
    await session.commit()
    return {"success": True, "previous_status": previous, "new_status": new_status}


async def admin_update_tracking(
    session: AsyncSession,
    order_id: uuid.UUID,
    *,
    courier_company: str | None,
    tracking_number: str | None,
    company_courier_company: str | None,
    company_tracking_number: str | None,
) -> Order:
    order = await session.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None:
        raise NotFoundError("Order not found")
    if order.status in ("배송완료", "완료", "취소"):
        raise DomainError(
            f"Tracking cannot be updated for order status: {order.status}", code="invalid_status"
        )
    now = datetime.now(UTC)
    if courier_company is not None:
        order.courier_company = courier_company.strip() or None
    if tracking_number is not None:
        value = tracking_number.strip() or None
        order.tracking_number = value
        order.shipped_at = (order.shipped_at or now) if value else None
    if company_courier_company is not None:
        order.company_courier_company = company_courier_company.strip() or None
    if company_tracking_number is not None:
        value = company_tracking_number.strip() or None
        order.company_tracking_number = value
        order.company_shipped_at = (order.company_shipped_at or now) if value else None
    await session.commit()
    await session.refresh(order)
    return order
