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
from db.models.commerce import (
    Coupon,
    Order,
    OrderItem,
    PaymentIncident,
    RepairPickupRequest,
    UserCoupon,
)
from db.models.tokens import DesignToken
from obs import request_id_var
from sqlalchemy import CursorResult, exists, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import USER_LOCK, advisory_xact_lock
from api.domains.orders.service import (
    log_status,
    order_coupon_ids,
    restore_reserved_order_coupons,
)
from api.domains.payments.operation_journal import (
    persist_payment_operation_outcome,
    prepare_payment_operation,
    set_payment_operation_outcome,
)
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
        query = query.with_for_update().execution_options(populate_existing=True)
    return list((await session.scalars(query)).all())


async def _has_open_confirm_incident(session: AsyncSession, order_ids: list[uuid.UUID]) -> bool:
    return bool(
        await session.scalar(
            select(
                exists().where(
                    PaymentIncident.status == "open",
                    PaymentIncident.incident_type.in_(("confirm", "amount_mismatch")),
                    PaymentIncident.order_id.in_(order_ids),
                )
            )
        )
    )


async def _record_confirm_incident(
    session: AsyncSession,
    *,
    operation_id: uuid.UUID,
    phase: str,
    error_type: str,
    provider_http_status: int | None = None,
    provider_status: str | None = None,
) -> PaymentIncident:
    """외부 호출 전에 만든 operation을 open incident로 유지한다."""
    return await persist_payment_operation_outcome(
        session,
        operation_id,
        phase=phase,
        error_type=error_type,
        provider_http_status=provider_http_status,
        provider_status=provider_status,
    )


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
    order_ids = [order.id for order in orders]
    representative_order_id = order_ids[0]
    if await _has_open_confirm_incident(session, order_ids):
        raise ConflictError(
            "결제 결과 대사가 필요한 주문입니다",
            code="payment_reconciliation_required",
        )

    await _ensure_sample_orders_couponable(session, orders)

    # ---- lock: 대기중→결제중 (커밋해 Toss 호출 동안 상태 유지) ----
    orders = await _group_orders(session, body.payment_group_id, for_update=True)
    locked_order_ids = [order.id for order in orders]
    if await _has_open_confirm_incident(session, locked_order_ids):
        raise ConflictError(
            "결제 결과 대사가 필요한 주문입니다",
            code="payment_reconciliation_required",
        )
    already_confirmed = False
    for order in orders:
        if order.status == "대기중":
            log_status(session, order, "결제중", changed_by=user.id, memo="payment lock")
            order.payment_key = body.payment_key
        elif order.status == "결제중":
            if order.payment_key and order.payment_key != body.payment_key:
                raise ConflictError(
                    "기존 결제 시도와 결제키가 일치하지 않습니다",
                    code="payment_key_mismatch",
                )
            order.payment_key = body.payment_key
        elif order.status == post_map[order.id]:
            already_confirmed = True
        else:
            raise ConflictError(f"Order {order.order_number} is not payable", code="not_payable")
    if already_confirmed:
        await session.commit()
        return await _done_response(session, orders)

    operation = prepare_payment_operation(
        session,
        incident_type="confirm",
        actor_id=user.id,
        order_id=representative_order_id,
        expected_amount=total,
        details={"payment_group_id": str(body.payment_group_id)},
    )
    # 주문의 결제 lock과 operation journal이 외부 호출 전에 함께 durable해진다.
    await session.commit()
    operation_id = operation.id

    # ---- Toss 승인 (금액은 항상 DB 재계산 합) ----
    try:
        result = await toss.confirm(body.payment_key, str(body.payment_group_id), total)
    except Exception as exc:
        await _record_confirm_incident(
            session,
            operation_id=operation_id,
            phase="confirm_outcome_unknown",
            error_type=type(exc).__name__,
        )
        raise UpstreamError(
            "결제 승인 결과를 확인할 수 없어 관리자 대사가 필요합니다",
            code="payment_outcome_unknown",
        ) from exc
    if not result.ok:
        # 재시도가 이미 승인된 결제를 다시 승인하려 한 경우 — 조회로 확인 후 확정.
        # 이걸 실패로 처리하면 unlock→대기중→stale 취소로 "돈 받고 주문 취소"가 된다.
        if result.body.get("code") == "ALREADY_PROCESSED_PAYMENT":
            try:
                recovered = await _recover_already_processed(
                    session,
                    user,
                    toss,
                    body,
                    post_map,
                    total,
                    operation_id=operation_id,
                )
            except Exception as exc:
                await _record_confirm_incident(
                    session,
                    operation_id=operation_id,
                    phase="already_processed_recovery_failed",
                    error_type=type(exc).__name__,
                    provider_http_status=result.status,
                )
                raise UpstreamError(
                    "승인된 결제의 조회 결과를 확인할 수 없어 관리자 대사가 필요합니다",
                    code="payment_reconciliation_required",
                ) from exc
            if recovered is not None:
                return recovered
            await _record_confirm_incident(
                session,
                operation_id=operation_id,
                phase="already_processed_verification_failed",
                error_type="provider_verification_failed",
                provider_http_status=result.status,
            )
            raise ConflictError(
                "승인된 결제의 상태 대사가 필요합니다",
                code="payment_reconciliation_required",
            )
        if result.status >= 500:
            await _record_confirm_incident(
                session,
                operation_id=operation_id,
                phase="provider_response_uncertain",
                error_type="provider_server_error",
                provider_http_status=result.status,
            )
            raise UpstreamError(
                "결제 승인 결과를 확인할 수 없어 관리자 대사가 필요합니다",
                code="payment_outcome_unknown",
            )
        await set_payment_operation_outcome(
            session,
            operation_id,
            phase="provider_rejected",
            status="resolved",
            resolved_by=user.id,
            resolution_memo="provider rejected payment confirmation",
            provider_http_status=result.status,
            provider_status=(
                result.body.get("status") if isinstance(result.body.get("status"), str) else None
            ),
        )
        await _unlock(session, user, body.payment_group_id)
        raise DomainError(
            result.body.get("message", "결제 승인에 실패했습니다"),
            code=result.body.get("code", "toss_error"),
            status=result.status if 400 <= result.status < 600 else 502,
        )

    # ---- confirm: 결제중 → 결제후 상태 + 부수효과 ----
    try:
        return await _confirm(
            session,
            user.id,
            body.payment_key,
            body.payment_group_id,
            post_map,
            operation_id=operation_id,
        )
    except Exception as exc:
        logger.critical(
            "Toss 승인 성공 후 DB 확정 실패 — 수동 개입 필요: payment_group_id=%s payment_key=%s",
            body.payment_group_id,
            mask_payment_key(body.payment_key),
        )
        provider_status = result.body.get("status")
        await _record_confirm_incident(
            session,
            operation_id=operation_id,
            phase="provider_succeeded_db_failed",
            error_type=type(exc).__name__,
            provider_http_status=result.status,
            provider_status=provider_status if isinstance(provider_status, str) else None,
        )
        raise UpstreamError(
            "결제는 승인됐지만 주문 반영에 실패해 관리자 대사가 필요합니다",
            code="payment_reconciliation_required",
        ) from exc


async def _recover_already_processed(
    session: AsyncSession,
    user: User,
    toss: TossClient,
    body: PaymentConfirmRequest,
    post_map: dict[uuid.UUID, str],
    total: int,
    *,
    operation_id: uuid.UUID,
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
    return await _confirm(
        session,
        user.id,
        body.payment_key,
        body.payment_group_id,
        post_map,
        operation_id=operation_id,
    )


async def _confirm(
    session: AsyncSession,
    actor_id: uuid.UUID | None,
    payment_key: str,
    group_id: uuid.UUID,
    post_map: dict[uuid.UUID, str],
    *,
    operation_id: uuid.UUID | None = None,
) -> PaymentConfirmResponse:
    orders = await _group_orders(session, group_id, for_update=True)
    if all(o.status == post_map[o.id] for o in orders):
        if operation_id is not None:
            await set_payment_operation_outcome(
                session,
                operation_id,
                phase="already_applied",
                status="resolved",
                resolved_by=actor_id,
                resolution_memo="payment was already applied",
                observed_amount=sum(order.total_price for order in orders),
            )
            await session.commit()
        return await _done_response(session, orders)  # 경합 승자에게 양보 — 멱등
    confirmed, total_tokens = await _apply_confirmation(
        session,
        orders,
        payment_key,
        post_map,
        actor_id,
        operation_id=operation_id,
    )
    return PaymentConfirmResponse(orders=confirmed, token_amount=total_tokens)


async def reconcile_confirmed_payment(
    session: AsyncSession,
    *,
    group_id: uuid.UUID,
    payment_key: str,
    actor_id: uuid.UUID,
) -> tuple[bool, str]:
    """Toss 조회 검증을 마친 호출자만 쓰는 결제 확정 DB 반영 경로."""
    orders = await _group_orders(session, group_id, for_update=True)
    if not orders:
        await session.commit()
        return False, "missing_payment_group"
    post_map = {order.id: await _post_status(session, order) for order in orders}
    if all(order.status == post_map[order.id] for order in orders):
        if any(order.payment_key != payment_key for order in orders):
            await session.commit()
            return False, "payment_key_mismatch"
        await session.commit()
        return True, "already_consistent"
    if not all(order.status == "결제중" for order in orders):
        await session.commit()
        return False, "mixed_order_state"
    await _apply_confirmation(session, orders, payment_key, post_map, actor_id)
    return True, "applied"


async def confirmed_payment_is_consistent(
    session: AsyncSession,
    *,
    group_id: uuid.UUID,
    payment_key: str,
) -> bool:
    orders = await _group_orders(session, group_id, for_update=True)
    if not orders:
        return False
    post_map = {order.id: await _post_status(session, order) for order in orders}
    return all(
        order.status == post_map[order.id] and order.payment_key == payment_key for order in orders
    )


async def _apply_confirmation(
    session: AsyncSession,
    orders: list[Order],
    payment_key: str,
    post_map: dict[uuid.UUID, str],
    actor_id: uuid.UUID | None,
    *,
    operation_id: uuid.UUID | None = None,
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
    coupon_ids = await order_coupon_ids(session, [o.id for o in orders])
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
    if operation_id is not None:
        await set_payment_operation_outcome(
            session,
            operation_id,
            phase="applied",
            status="resolved",
            resolved_by=actor_id,
            resolution_memo="provider confirmation applied",
            observed_amount=sum(order.total_price for order in orders),
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
            order.payment_key = None
    await restore_reserved_order_coupons(session, orders)
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


async def reconcile_from_webhook(
    session: AsyncSession, toss: TossClient, payment_key: str | None
) -> dict:
    """Toss 상태 변경 통지 → 조회 재검증 → DB↔Toss 불일치 교정.

    페이로드는 힌트(paymentKey)로만 쓴다 — 진위·상태·금액은 전부 조회 API 기준
    (Toss 공식 권장 검증 방식). 상태 기반 + work_id 멱등이라 재전송에 안전하며,
    처리 불가(조회 5xx)만 5xx로 응답해 Toss 재시도를 유도한다.
    """
    if payment_key is None:
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

    # 취소 웹훅은 토큰 구매 지급분을 회수한다. 토큰 사용과 같은 USER_LOCK을
    # 주문 row lock보다 먼저 잡아야 use_tokens가 회수 직전의 잔액을 읽지 않고,
    # 환불 경로의 공통 lock 순서(USER → order)도 깨지지 않는다.
    if toss_status == "CANCELED":
        group_user_ids = await session.scalars(
            select(Order.user_id).where(Order.payment_group_id == group_id)
        )
        user_ids = sorted(set(group_user_ids.all()), key=str)
        if not user_ids:
            return {"handled": False, "reason": "unknown_order"}
        for user_id in user_ids:
            await advisory_xact_lock(session, USER_LOCK.format(user_id=user_id))

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
        total = sum(o.total_price for o in orders)
        provider_payment_key = payment.get("paymentKey")
        provider_key_matches = provider_payment_key == payment_key
        stored_keys_match = all(order.payment_key == payment_key for order in orders)
        payment_key_matches = provider_key_matches and stored_keys_match
        provider_amount = payment.get("totalAmount")
        amount_matches = (
            isinstance(provider_amount, int)
            and not isinstance(provider_amount, bool)
            and provider_amount == total
        )
        if not payment_key_matches or not amount_matches:
            reason = "payment_key_mismatch" if not payment_key_matches else "amount_mismatch"
            await _record_webhook_cancel_mismatch(
                session,
                orders=orders,
                payment_key=payment_key,
                expected_amount=total,
                observed_amount=provider_amount,
                reason=reason,
                provider_key_matches=provider_key_matches,
                stored_keys_match=stored_keys_match,
            )
            logger.critical(
                "웹훅 취소 대사 불일치 — 수동 확인 필요: payment_group_id=%s reason=%s",
                group_id,
                reason,
            )
            return {"handled": False, "reason": reason}

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


async def _record_webhook_cancel_mismatch(
    session: AsyncSession,
    *,
    orders: list[Order],
    payment_key: str,
    expected_amount: int,
    observed_amount: object,
    reason: str,
    provider_key_matches: bool,
    stored_keys_match: bool,
) -> None:
    """CANCELED 자동 반영을 막은 불일치를 관리자 대사 queue에 멱등 기록한다."""

    representative = orders[0]
    operation_id = str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"essesion:webhook-cancel:{representative.payment_group_id}:{payment_key}:{reason}",
        )
    )
    observed = (
        observed_amount
        if isinstance(observed_amount, int)
        and not isinstance(observed_amount, bool)
        and observed_amount >= 0
        else None
    )
    await session.execute(
        pg_insert(PaymentIncident)
        .values(
            operation_id=operation_id,
            # CANCELED 검증 실패는 confirm 금액 대사와 의미가 다르다. 자동 복구 대상이
            # 아닌 mixed_state로 남기고 세부 원인은 details.reason으로 구분한다.
            incident_type="mixed_state",
            status="open",
            request_id=request_id_var.get() or "unknown",
            actor_id=None,
            order_id=representative.id,
            expected_amount=expected_amount,
            observed_amount=observed,
            details={
                "phase": "webhook_cancel_verification_failed",
                "payment_group_id": str(representative.payment_group_id),
                "reason": reason,
                "provider_payment_key_matches_lookup": provider_key_matches,
                "stored_payment_keys_match_lookup": stored_keys_match,
                "provider_status": "CANCELED",
            },
        )
        .on_conflict_do_nothing(index_elements=[PaymentIncident.operation_id])
    )
    await session.commit()


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
