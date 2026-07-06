"""결제 확정 — lock(대기중→결제중) → Toss confirm → confirm/unlock (money.md §5).

승인은 동기(successUrl 콜백 → confirm)가 원천 — Toss 카드결제 구조상 confirm API
호출이 곧 승인이다. 멱등성은 DB 상태로 보장(이미 확정이면 DONE, lock이 이중 결제
차단). 여기에 두 겹의 자동 대사(reconciliation)를 얹는다:
- confirm 재시도가 ALREADY_PROCESSED_PAYMENT를 받으면 조회 API로 확인 후 DB 확정
  ("돈은 캡처됐는데 주문은 취소되는 창" 차단).
- POST /payments/webhook: Toss 상태 변경 통지 수신 — 페이로드를 신뢰하지 않고
  조회 API로 재검증한 뒤 DB↔Toss 불일치만 교정(멈춘 결제중 확정, 대시보드 취소 반영).
  교정은 상태 기반 + work_id 유니크로 멱등이라 웹훅 재전송에 안전.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from datetime import date as date_type
from typing import Any, cast

from db.models.auth import User
from db.models.commerce import Coupon, Order, OrderItem, RepairPickupRequest, UserCoupon
from db.models.tokens import DesignToken
from sqlalchemy import CursorResult, exists, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.domains.orders.service import log_status
from api.domains.payments.schemas import (
    ConfirmedOrder,
    PaymentConfirmRequest,
    PaymentConfirmResponse,
)
from api.errors import ConflictError, DomainError, ForbiddenError, NotFoundError, UpstreamError
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

    await _ensure_sample_orders_couponable(session, orders)

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
        # 재시도가 이미 승인된 결제를 다시 승인하려 한 경우 — 조회로 확인 후 확정.
        # 이걸 실패로 처리하면 unlock→대기중→stale 취소로 "돈 받고 주문 취소"가 된다.
        if result.body.get("code") == "ALREADY_PROCESSED_PAYMENT":
            recovered = await _recover_already_processed(session, user, toss, body, post_map, total)
            if recovered is not None:
                return recovered
        await _unlock(session, user, body.payment_group_id)
        raise DomainError(
            result.body.get("message", "결제 승인에 실패했습니다"),
            code=result.body.get("code", "toss_error"),
            status=result.status if 400 <= result.status < 600 else 502,
        )

    # ---- confirm: 결제중 → 결제후 상태 + 부수효과 ----
    try:
        return await _confirm(session, user.id, body.payment_key, body.payment_group_id, post_map)
    except Exception:
        logger.critical(
            "Toss 승인 성공 후 DB 확정 실패 — 수동 개입 필요: payment_group_id=%s payment_key=%s",
            body.payment_group_id,
            mask_payment_key(body.payment_key),
        )
        raise


async def _recover_already_processed(
    session: AsyncSession,
    user: User,
    toss: TossClient,
    body: PaymentConfirmRequest,
    post_map: dict[uuid.UUID, str],
    total: int,
) -> PaymentConfirmResponse | None:
    """이미 승인된 결제의 재확정 — 조회 API로 진위·금액을 검증한 뒤 DB만 확정."""
    lookup = await toss.get_payment(body.payment_key)
    if (
        not lookup.ok
        or lookup.body.get("status") != "DONE"
        or lookup.body.get("orderId") != str(body.payment_group_id)
        or lookup.body.get("totalAmount") != total
    ):
        return None
    logger.warning(
        "ALREADY_PROCESSED 복구: 조회 검증 통과 — DB 확정 진행 payment_group_id=%s",
        body.payment_group_id,
    )
    return await _confirm(session, user.id, body.payment_key, body.payment_group_id, post_map)


async def _confirm(
    session: AsyncSession,
    actor_id: uuid.UUID | None,
    payment_key: str,
    group_id: uuid.UUID,
    post_map: dict[uuid.UUID, str],
) -> PaymentConfirmResponse:
    orders = await _group_orders(session, group_id, for_update=True)
    if all(o.status == post_map[o.id] for o in orders):
        return await _done_response(session, orders)  # 경합 승자에게 양보 — 멱등
    confirmed, total_tokens = await _apply_confirmation(
        session, orders, payment_key, post_map, actor_id
    )
    return PaymentConfirmResponse(orders=confirmed, token_amount=total_tokens)


async def _apply_confirmation(
    session: AsyncSession,
    orders: list[Order],
    payment_key: str,
    post_map: dict[uuid.UUID, str],
    actor_id: uuid.UUID | None,
) -> tuple[list[ConfirmedOrder], int | None]:
    """결제중 → 결제후 상태 + 부수효과(토큰 지급·샘플 쿠폰·쿠폰 사용확정). 커밋 포함.

    orders는 FOR UPDATE로 잠긴 상태여야 한다. actor_id=None은 시스템(웹훅 대사).
    """
    confirmed: list[ConfirmedOrder] = []
    total_tokens: int | None = None
    masked = mask_payment_key(payment_key)

    for order in orders:
        if order.status != "결제중":
            raise ConflictError(f"Order {order.order_number} is not payable", code="not_payable")
        post = post_map[order.id]
        log_status(session, order, post, changed_by=actor_id, memo=f"payment confirmed: {masked}")
        order.payment_key = payment_key

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

    owner_id = orders[0].user_id  # 그룹은 생성 구조상 단일 유저
    coupon_ids = await _group_coupon_ids(session, [o.id for o in orders])
    if coupon_ids:
        await session.execute(
            update(UserCoupon)
            .where(
                UserCoupon.user_id == owner_id,
                UserCoupon.status == "reserved",
                UserCoupon.id.in_(coupon_ids),
            )
            .values(status="used", used_at=datetime.now(UTC))
        )
    await session.commit()
    return confirmed, total_tokens


async def _unlock(session: AsyncSession, user: User, group_id: uuid.UUID) -> None:
    """Toss 실패 — 결제중→대기중 + 쿠폰 reserved→active 복원."""
    orders = await _group_orders(session, group_id, for_update=True)
    for order in orders:
        if order.status == "결제중":
            log_status(
                session,
                order,
                "대기중",
                changed_by=user.id,
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


async def _sample_followup_key(
    session: AsyncSession, order: Order
) -> tuple[str | None, str | None]:
    """샘플 주문의 후속 쿠폰 매핑 키 — 사전검증(confirm)과 발급이 같은 판정을 공유한다."""
    item = await session.scalar(select(OrderItem).where(OrderItem.order_id == order.id))
    data = (item.item_data or {}) if item else {}
    sample_type = data.get("sample_type")
    design_type = (data.get("options") or {}).get("design_type")
    return (sample_type, None if sample_type == "sewing" else design_type)


async def _ensure_sample_orders_couponable(session: AsyncSession, orders: list[Order]) -> None:
    """샘플 주문의 sample_type 매핑을 Toss 승인 전에 검증 — 승인 후 터지면
    "돈 받고 DB 미확정" 수동 개입 창이 생긴다 (money.md §5 사전검증)."""
    for order in orders:
        if order.order_type != "sample":
            continue
        if await _sample_followup_key(session, order) not in SAMPLE_FOLLOWUP_COUPON:
            raise DomainError("Unsupported sample_type", code="invalid_sample")


async def _issue_sample_followup_coupon(session: AsyncSession, order: Order) -> bool:
    """샘플 결제 확정 → 후속 정규주문 할인쿠폰 발급 (money.md §4)."""
    mapping_key = await _sample_followup_key(session, order)
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


# ---- 웹훅 대사 (reconciliation) ----


async def reconcile_from_webhook(session: AsyncSession, toss: TossClient, payload: dict) -> dict:
    """Toss 상태 변경 통지 → 조회 재검증 → DB↔Toss 불일치 교정.

    페이로드는 힌트(paymentKey)로만 쓴다 — 진위·상태·금액은 전부 조회 API 기준
    (Toss 공식 권장 검증 방식). 상태 기반 + work_id 멱등이라 재전송에 안전하며,
    처리 불가(조회 5xx)만 5xx로 응답해 Toss 재시도를 유도한다.
    """
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    payment_key = data.get("paymentKey") if isinstance(data, dict) else None
    if not isinstance(payment_key, str) or not payment_key:
        return {"handled": False, "reason": "no_payment_key"}

    lookup = await toss.get_payment(payment_key)
    if not lookup.ok:
        if 400 <= lookup.status < 500:
            return {"handled": False, "reason": "payment_not_found"}  # 위조/무관 — ack
        raise UpstreamError("Toss 결제 조회에 실패했습니다")  # 5xx → Toss가 웹훅 재시도

    payment = lookup.body
    toss_status = payment.get("status")
    try:
        group_id = uuid.UUID(str(payment.get("orderId")))
    except ValueError:
        return {"handled": False, "reason": "unknown_order"}

    orders = await _group_orders(session, group_id, for_update=True)
    if not orders:
        return {"handled": False, "reason": "unknown_order"}
    post_map = {o.id: await _post_status(session, o) for o in orders}

    if toss_status == "DONE":
        if all(o.status == post_map[o.id] for o in orders):
            return {"handled": True, "action": "already_consistent"}
        if not all(o.status == "결제중" for o in orders):
            logger.critical(
                "웹훅 대사 불가(혼합 상태) — 수동 확인 필요: payment_group_id=%s statuses=%s",
                group_id,
                [o.status for o in orders],
            )
            return {"handled": False, "reason": "inconsistent_state"}
        total = sum(o.total_price for o in orders)
        if payment.get("totalAmount") != total:
            logger.critical(
                "웹훅 대사 금액 불일치 — 수동 확인 필요: payment_group_id=%s toss=%s db=%s",
                group_id,
                payment.get("totalAmount"),
                total,
            )
            return {"handled": False, "reason": "amount_mismatch"}
        confirmed, _ = await _apply_confirmation(
            session, orders, payment_key, post_map, actor_id=None
        )
        logger.warning("웹훅 대사: 멈춘 결제 확정 payment_group_id=%s", group_id)
        return {"handled": True, "action": "confirmed", "orders": len(confirmed)}

    if toss_status == "PARTIAL_CANCELED":
        logger.warning(
            "웹훅: 부분취소는 자동 대사 범위 밖 — 수동 처리 필요: payment_group_id=%s", group_id
        )
        return {"handled": False, "reason": "partial_cancel_manual"}

    if toss_status == "CANCELED":
        changed = 0
        for order in orders:
            if order.status == "취소":
                continue
            # 대시보드 직접 취소 동기화 — 상태기계를 의도적으로 우회(돈이 이미 환불됨)
            log_status(session, order, "취소", changed_by=None, memo="Toss 웹훅 취소 동기화")
            changed += 1
            if order.order_type == "token":
                await _claw_back_purchased_tokens(session, order)
        await session.commit()
        # 정책: 사용확정(used)된 쿠폰 복원은 수동 — 부분 사용·재발급 판단이 필요
        return {"handled": True, "action": "canceled", "orders": changed}

    return {"handled": False, "reason": f"unhandled_status:{toss_status}"}


async def _claw_back_purchased_tokens(session: AsyncSession, order: Order) -> None:
    """대시보드 취소된 토큰 주문의 지급분 회수 — work_id 멱등."""
    granted = await session.scalar(
        select(func.coalesce(func.sum(DesignToken.amount), 0)).where(
            DesignToken.user_id == order.user_id,
            DesignToken.type == "purchase",
            DesignToken.token_class == "paid",
            DesignToken.source_order_id == order.id,
        )
    )
    if not granted or granted <= 0:
        return
    expires = await session.scalar(
        select(DesignToken.expires_at).where(
            DesignToken.type == "purchase", DesignToken.source_order_id == order.id
        )
    )
    await session.execute(
        pg_insert(DesignToken)
        .values(
            user_id=order.user_id,
            amount=-granted,
            type="refund",
            token_class="paid",
            description="Toss 웹훅 취소 동기화 — 토큰 회수",
            work_id=f"webhook_cancel_{order.id}",
            source_order_id=order.id,
            expires_at=expires,
        )
        .on_conflict_do_nothing(
            index_elements=[DesignToken.work_id], index_where=DesignToken.work_id.isnot(None)
        )
    )
