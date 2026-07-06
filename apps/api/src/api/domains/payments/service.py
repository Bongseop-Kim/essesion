"""결제 확정 — lock(대기중→결제중) → Toss confirm → confirm/unlock (money.md §5).

웹훅 없음(원 설계): 프론트 successUrl 콜백이 이 confirm을 호출한다. 멱등성은 DB
상태로 보장 — 이미 확정이면 Toss 호출 없이 DONE, lock은 이중 결제를 차단.
lock 커밋 후 Toss를 호출하고 결과에 따라 별도 트랜잭션으로 confirm/unlock한다.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from datetime import date as date_type
from typing import Any, cast

from db.models.auth import User
from db.models.commerce import Coupon, Order, OrderItem, RepairPickupRequest, UserCoupon
from db.models.tokens import DesignToken
from sqlalchemy import CursorResult, exists, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.domains.orders.service import log_status
from api.domains.payments.schemas import (
    ConfirmedOrder,
    PaymentConfirmRequest,
    PaymentConfirmResponse,
)
from api.errors import ConflictError, DomainError, ForbiddenError, NotFoundError
from api.integrations.toss import TossClient
from api.pricing import get_pricing_constants

logger = logging.getLogger(__name__)

PLAN_LABELS = {"starter": "Starter", "popular": "Popular", "pro": "Pro"}

SAMPLE_FOLLOWUP_COUPON = {
    ("sewing", None): ("SAMPLE_DISCOUNT_SEWING", "sample_discount_sewing"),
    ("fabric", "PRINTING"): ("SAMPLE_DISCOUNT_FABRIC_PRINTING", "sample_discount_fabric_printing"),
    ("fabric", "YARN_DYED"): (
        "SAMPLE_DISCOUNT_FABRIC_YARN_DYED",
        "sample_discount_fabric_yarn_dyed",
    ),
    ("fabric_and_sewing", "PRINTING"): (
        "SAMPLE_DISCOUNT_FABRIC_AND_SEWING_PRINTING",
        "sample_discount_fabric_and_sewing_printing",
    ),
    ("fabric_and_sewing", "YARN_DYED"): (
        "SAMPLE_DISCOUNT_FABRIC_AND_SEWING_YARN_DYED",
        "sample_discount_fabric_and_sewing_yarn_dyed",
    ),
}


def mask_payment_key(payment_key: str) -> str:
    return "****" if len(payment_key) <= 8 else "****" + payment_key[-8:]


async def _post_status(session: AsyncSession, order: Order) -> str:
    if order.order_type == "sale":
        return "진행중"
    if order.order_type == "token":
        return "완료"
    if order.order_type == "repair":
        has_pickup = await session.scalar(
            select(exists().where(RepairPickupRequest.order_id == order.id))
        )
        return "수거예정" if has_pickup else "발송대기"
    return "접수"


async def _group_orders(
    session: AsyncSession, group_id: uuid.UUID, *, for_update: bool = False
) -> list[Order]:
    query = select(Order).where(Order.payment_group_id == group_id).order_by(Order.created_at)
    if for_update:
        query = query.with_for_update()
    return list((await session.scalars(query)).all())


async def _group_coupon_ids(session: AsyncSession, order_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    rows = await session.scalars(
        select(OrderItem.applied_user_coupon_id).where(
            OrderItem.order_id.in_(order_ids), OrderItem.applied_user_coupon_id.isnot(None)
        )
    )
    return list({r for r in rows if r is not None})


async def _token_order_amount(session: AsyncSession, order: Order) -> tuple[int, str]:
    item = await session.scalar(select(OrderItem).where(OrderItem.order_id == order.id))
    data = (item.item_data or {}) if item else {}
    token_amount, plan_key = data.get("token_amount"), data.get("plan_key")
    if not isinstance(token_amount, int) or token_amount <= 0 or not plan_key:
        raise DomainError("Invalid token order", code="invalid_token_order")
    return token_amount, plan_key


async def _done_response(session: AsyncSession, orders: list[Order]) -> PaymentConfirmResponse:
    confirmed = []
    total_tokens: int | None = None
    for order in orders:
        token_amount = None
        if order.order_type == "token":
            token_amount, _ = await _token_order_amount(session, order)
            total_tokens = (total_tokens or 0) + token_amount
        confirmed.append(
            ConfirmedOrder(
                order_id=order.id,
                order_number=order.order_number,
                order_type=order.order_type,
                status=order.status,
                token_amount=token_amount,
            )
        )
    return PaymentConfirmResponse(orders=confirmed, token_amount=total_tokens)


async def confirm_payment(
    session: AsyncSession, user: User, toss: TossClient, body: PaymentConfirmRequest
) -> PaymentConfirmResponse:
    if body.amount <= 0:
        raise DomainError("Invalid amount", code="invalid_amount")
    orders = await _group_orders(session, body.payment_group_id)
    if not orders:
        raise NotFoundError("주문을 찾을 수 없습니다")
    if any(o.user_id != user.id for o in orders):
        raise ForbiddenError()

    post_map = {o.id: await _post_status(session, o) for o in orders}

    # 멱등 사전체크 — 전부 결제후 상태면 Toss 호출 없이 DONE
    if all(o.status == post_map[o.id] for o in orders):
        return await _done_response(session, orders)

    for order in orders:
        if order.status not in ("대기중", "결제중"):
            raise ConflictError(f"Order {order.order_number} is not payable", code="not_payable")

    total = sum(o.total_price for o in orders)
    if total != body.amount:
        raise DomainError("Amount mismatch", code="amount_mismatch")

    # ---- lock: 대기중→결제중 (커밋해 Toss 호출 동안 상태 유지) ----
    orders = await _group_orders(session, body.payment_group_id, for_update=True)
    already_confirmed = False
    for order in orders:
        if order.status == "대기중":
            log_status(session, order, "결제중", changed_by=user.id, memo="payment lock")
        elif order.status == "결제중":
            pass  # 재시도 — 멱등
        elif order.status == post_map[order.id]:
            already_confirmed = True
        else:
            raise ConflictError(f"Order {order.order_number} is not payable", code="not_payable")
    await session.commit()

    if already_confirmed:
        return await _done_response(session, orders)

    # ---- Toss 승인 (금액은 항상 DB 재계산 합) ----
    result = await toss.confirm(body.payment_key, str(body.payment_group_id), total)
    if not result.ok:
        await _unlock(session, user, body.payment_group_id)
        raise DomainError(
            result.body.get("message", "결제 승인에 실패했습니다"),
            code=result.body.get("code", "toss_error"),
            status=result.status if 400 <= result.status < 600 else 502,
        )

    # ---- confirm: 결제중 → 결제후 상태 + 부수효과 ----
    try:
        return await _confirm(session, user, body, post_map)
    except Exception:
        logger.critical(
            "Toss 승인 성공 후 DB 확정 실패 — 수동 개입 필요: payment_group_id=%s payment_key=%s",
            body.payment_group_id,
            mask_payment_key(body.payment_key),
        )
        raise


async def _confirm(
    session: AsyncSession,
    user: User,
    body: PaymentConfirmRequest,
    post_map: dict[uuid.UUID, str],
) -> PaymentConfirmResponse:
    orders = await _group_orders(session, body.payment_group_id, for_update=True)
    if all(o.status == post_map[o.id] for o in orders):
        return await _done_response(session, orders)  # 경합 승자에게 양보 — 멱등

    confirmed: list[ConfirmedOrder] = []
    total_tokens: int | None = None
    masked = mask_payment_key(body.payment_key)

    for order in orders:
        if order.status != "결제중":
            raise ConflictError(f"Order {order.order_number} is not payable", code="not_payable")
        post = post_map[order.id]
        log_status(
            session, order, post, changed_by=user.id, memo=f"payment confirmed: {masked}"
        )
        order.payment_key = body.payment_key

        token_amount = None
        coupon_issued = False
        if order.order_type == "token":
            token_amount = await _grant_purchased_tokens(session, order)
            total_tokens = (total_tokens or 0) + token_amount
        elif order.order_type == "sample":
            coupon_issued = await _issue_sample_followup_coupon(session, order)

        confirmed.append(
            ConfirmedOrder(
                order_id=order.id,
                order_number=order.order_number,
                order_type=order.order_type,
                status=post,
                token_amount=token_amount,
                coupon_issued=coupon_issued,
            )
        )

    coupon_ids = await _group_coupon_ids(session, [o.id for o in orders])
    if coupon_ids:
        await session.execute(
            update(UserCoupon)
            .where(
                UserCoupon.user_id == user.id,
                UserCoupon.status == "reserved",
                UserCoupon.id.in_(coupon_ids),
            )
            .values(status="used", used_at=datetime.now(UTC))
        )
    await session.commit()
    return PaymentConfirmResponse(orders=confirmed, token_amount=total_tokens)


async def _unlock(session: AsyncSession, user: User, group_id: uuid.UUID) -> None:
    """Toss 실패 — 결제중→대기중 + 쿠폰 reserved→active 복원."""
    orders = await _group_orders(session, group_id, for_update=True)
    for order in orders:
        if order.status == "결제중":
            log_status(
                session, order, "대기중", changed_by=user.id,
                memo="payment unlock: approval failed",
            )
    coupon_ids = await _group_coupon_ids(session, [o.id for o in orders])
    if coupon_ids:
        await session.execute(
            update(UserCoupon)
            .where(
                UserCoupon.user_id == user.id,
                UserCoupon.status == "reserved",
                UserCoupon.id.in_(coupon_ids),
            )
            .values(status="active")
        )
    await session.commit()


async def _grant_purchased_tokens(session: AsyncSession, order: Order) -> int:
    token_amount, plan_key = await _token_order_amount(session, order)
    label = PLAN_LABELS.get(plan_key, plan_key)
    await session.execute(
        pg_insert(DesignToken)
        .values(
            user_id=order.user_id,
            amount=token_amount,
            type="purchase",
            token_class="paid",
            description=f"{label} 플랜 구매",
            work_id=f"order_{order.id}",
            source_order_id=order.id,
            expires_at=datetime.now(UTC) + timedelta(days=365),
        )
        .on_conflict_do_nothing(
            index_elements=[DesignToken.work_id], index_where=DesignToken.work_id.isnot(None)
        )
    )
    return token_amount


async def _issue_sample_followup_coupon(session: AsyncSession, order: Order) -> bool:
    """샘플 결제 확정 → 후속 정규주문 할인쿠폰 발급 (money.md §4)."""
    item = await session.scalar(select(OrderItem).where(OrderItem.order_id == order.id))
    data = (item.item_data or {}) if item else {}
    sample_type = data.get("sample_type")
    design_type = (data.get("options") or {}).get("design_type")
    mapping_key = (sample_type, None if sample_type == "sewing" else design_type)
    if mapping_key not in SAMPLE_FOLLOWUP_COUPON:
        raise DomainError("Unsupported sample_type", code="invalid_sample")
    coupon_name, pricing_key = SAMPLE_FOLLOWUP_COUPON[mapping_key]
    amount = (await get_pricing_constants(session, [pricing_key]))[pricing_key]

    coupon_id = (
        await session.execute(
            pg_insert(Coupon)
            .values(
                name=coupon_name,
                discount_type="fixed",
                discount_value=amount,
                max_discount_amount=amount,
                expiry_date=date_type(2099, 12, 31),
                is_active=True,
            )
            .on_conflict_do_update(
                index_elements=[Coupon.name],
                set_={"discount_value": amount, "max_discount_amount": amount, "is_active": True},
            )
            .returning(Coupon.id)
        )
    ).scalar_one()

    result = await session.execute(
        pg_insert(UserCoupon)
        .values(user_id=order.user_id, coupon_id=coupon_id, status="active")
        .on_conflict_do_nothing(index_elements=[UserCoupon.user_id, UserCoupon.coupon_id])
    )
    return bool(cast("CursorResult[Any]", result).rowcount)
