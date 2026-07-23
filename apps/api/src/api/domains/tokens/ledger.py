"""토큰 원장 — 잔액(만료 필터)·유료 우선/만료 임박순 차감·work_id 멱등 (money.md §6)."""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from db.models.auth import User
from db.models.commerce import (
    Claim,
    ClaimNotificationLog,
    ClaimStatusLog,
    Order,
    OrderItem,
    PaymentIncident,
)
from db.models.tokens import DesignToken
from obs import request_id_var
from sqlalchemy import exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import USER_LOCK, advisory_xact_lock
from api.domains.admin.operations import idempotent_result, record_operation
from api.domains.payments.operation_journal import (
    persist_payment_operation_outcome,
    prepare_payment_operation,
    set_payment_operation_outcome,
)
from api.domains.tokens.schemas import TokenHistoryFilter
from api.errors import ConflictError, DomainError, NotFoundError, UpstreamError
from api.integrations.toss import TossClient
from api.numbering import generate_number
from api.pricing import get_admin_setting, get_pricing_constants

logger = logging.getLogger(__name__)

TOKEN_COST_SETTING = "design_token_cost_openai_render_standard"
PLAN_KEYS = ("starter", "popular", "pro")
TOKEN_DEBIT_ORDER = ("paid", "bonus", "free")

_not_expired = or_(DesignToken.expires_at.is_(None), DesignToken.expires_at > func.now())


async def get_balance(session: AsyncSession, user_id: uuid.UUID) -> dict[str, int]:
    paid = await session.scalar(
        select(func.coalesce(func.sum(DesignToken.amount), 0)).where(
            DesignToken.user_id == user_id, DesignToken.token_class == "paid", _not_expired
        )
    )
    bonus = await session.scalar(
        select(func.coalesce(func.sum(DesignToken.amount), 0)).where(
            DesignToken.user_id == user_id,
            DesignToken.token_class.in_(("bonus", "free")),
            _not_expired,
        )
    )
    paid, bonus = int(paid or 0), int(bonus or 0)
    return {"total": paid + bonus, "paid": paid, "bonus": bonus}


async def get_generate_cost(session: AsyncSession) -> int:
    cost_value = await get_admin_setting(session, TOKEN_COST_SETTING)
    if not cost_value or not cost_value.isdigit() or int(cost_value) <= 0:
        raise DomainError("토큰 비용이 설정되지 않았습니다", code="token_cost_not_configured")
    return int(cost_value)


async def list_history(
    session: AsyncSession,
    user_id: uuid.UUID,
    limit: int,
    offset: int,
    entry_type: TokenHistoryFilter | None,
) -> list[DesignToken]:
    query = select(DesignToken).where(DesignToken.user_id == user_id)
    if entry_type == "credit":
        query = query.where(
            DesignToken.type.in_(("purchase", "grant", "admin")), DesignToken.amount > 0
        )
    elif entry_type is not None:
        query = query.where(DesignToken.type == entry_type)
    rows = await session.scalars(
        query.order_by(DesignToken.created_at.desc(), DesignToken.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(rows)


def _idempotent_insert(values: dict):
    return (
        pg_insert(DesignToken)
        .values(**values)
        .on_conflict_do_nothing(
            index_elements=[DesignToken.work_id], index_where=DesignToken.work_id.isnot(None)
        )
    )


type TokenBatch = tuple[uuid.UUID | None, datetime | None, int]


def _balance_invariant_error() -> DomainError:
    return DomainError(
        "토큰 잔액 데이터가 올바르지 않습니다",
        code="token_balance_invariant_violation",
        status=409,
    )


async def _get_spendable_batches(
    session: AsyncSession, user_id: uuid.UUID
) -> dict[str, list[TokenBatch]]:
    """만료되지 않은 양수 배치를 반환하고 기존 음수 배치는 거부한다."""
    rows = (
        await session.execute(
            select(
                DesignToken.token_class,
                DesignToken.source_order_id,
                DesignToken.expires_at,
                func.sum(DesignToken.amount).label("balance"),
            )
            .where(DesignToken.user_id == user_id, _not_expired)
            .group_by(
                DesignToken.token_class,
                DesignToken.source_order_id,
                DesignToken.expires_at,
            )
            .order_by(
                DesignToken.token_class,
                DesignToken.expires_at.asc().nulls_last(),
                DesignToken.source_order_id.asc().nulls_last(),
            )
        )
    ).all()
    batches: dict[str, list[TokenBatch]] = {token_class: [] for token_class in TOKEN_DEBIT_ORDER}
    for token_class, source_order_id, expires_at, raw_balance in rows:
        batch_balance = int(raw_balance)
        if batch_balance < 0:
            raise _balance_invariant_error()
        if batch_balance > 0:
            batches[token_class].append((source_order_id, expires_at, batch_balance))
    return batches


def _summarize_batches(batches: dict[str, list[TokenBatch]]) -> dict[str, int]:
    by_class = {
        token_class: sum(batch[2] for batch in batches[token_class])
        for token_class in TOKEN_DEBIT_ORDER
    }
    return {
        "total": sum(by_class.values()),
        "paid": by_class["paid"],
        "bonus": by_class["bonus"] + by_class["free"],
    }


async def _insert_bucketed_debits(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    amount: int,
    entry_type: str,
    batches: dict[str, list[TokenBatch]],
    work_id_for: Callable[[str, int], str],
    description: str | None = None,
) -> None:
    remaining = amount
    for token_class in TOKEN_DEBIT_ORDER:
        for batch_index, (source_order_id, expires_at, batch_balance) in enumerate(
            batches[token_class]
        ):
            if remaining == 0:
                return
            take = min(remaining, batch_balance)
            await session.execute(
                _idempotent_insert(
                    dict(
                        user_id=user_id,
                        amount=-take,
                        type=entry_type,
                        token_class=token_class,
                        description=description,
                        work_id=work_id_for(token_class, batch_index),
                        source_order_id=source_order_id,
                        expires_at=expires_at,
                    )
                )
            )
            remaining -= take
    if remaining > 0:
        raise _balance_invariant_error()


@dataclass
class UseResult:
    success: bool
    cost: int
    balance: int
    error: str | None = None


async def use_tokens(session: AsyncSession, user_id: uuid.UUID, work_id: str) -> UseResult:
    """생성 1회 과금 — 4단계에서 워커 generate 경로가 호출한다."""
    cost = await get_generate_cost(session)

    await advisory_xact_lock(session, USER_LOCK.format(user_id=user_id))

    balance = await get_balance(session, user_id)
    pending_refund = await session.scalar(
        select(
            exists().where(
                Claim.user_id == user_id,
                Claim.type == "token_refund",
                Claim.status == "접수",
            )
        )
    )
    if pending_refund:
        await session.commit()
        return UseResult(False, cost, balance["total"], error="refund_pending")

    # work_id 멱등 — 이미 차감된 작업
    already = await session.scalar(
        select(
            exists().where(
                DesignToken.work_id.in_(
                    [
                        f"{work_id}_use_paid_0",
                        f"{work_id}_use_bonus",
                        f"{work_id}_use_bonus_0",
                        f"{work_id}_use_free",
                        f"{work_id}_use_free_0",
                    ]
                )
            )
        )
    )
    if already:
        await session.commit()
        return UseResult(True, cost, balance["total"])

    batches = await _get_spendable_batches(session, user_id)
    balance = _summarize_batches(batches)
    if balance["total"] < cost:
        await session.commit()
        return UseResult(False, cost, balance["total"], error="insufficient_tokens")

    def use_work_id(token_class: str, batch_index: int) -> str:
        if token_class in ("bonus", "free") and batch_index == 0:
            return f"{work_id}_use_{token_class}"
        return f"{work_id}_use_{token_class}_{batch_index}"

    await _insert_bucketed_debits(
        session,
        user_id=user_id,
        amount=cost,
        entry_type="use",
        batches=batches,
        work_id_for=use_work_id,
    )

    await session.commit()
    return UseResult(True, cost, balance["total"] - cost)


async def refund_failed_generation(
    session: AsyncSession, user_id: uuid.UUID, amount: int, charge_work_id: str
) -> None:
    """생성 실패 환불 — 실제 차감 배치를 그대로 반전하고 work_id로 멱등 처리한다."""
    if amount <= 0:
        return

    await advisory_xact_lock(session, USER_LOCK.format(user_id=user_id))
    debits = list(
        await session.scalars(
            select(DesignToken)
            .where(
                DesignToken.user_id == user_id,
                DesignToken.type == "use",
                DesignToken.work_id.startswith(f"{charge_work_id}_use_", autoescape=True),
            )
            .order_by(DesignToken.work_id)
        )
    )
    if sum(-debit.amount for debit in debits) != amount:
        raise _balance_invariant_error()

    for debit in debits:
        assert debit.work_id is not None
        await session.execute(
            _idempotent_insert(
                dict(
                    user_id=user_id,
                    amount=-debit.amount,
                    type="refund",
                    token_class=debit.token_class,
                    description="생성 실패 토큰 환불",
                    work_id=f"{debit.work_id}_refund",
                    source_order_id=debit.source_order_id,
                    expires_at=debit.expires_at,
                )
            )
        )
    await session.commit()


# ---- 플랜·구매 주문 ----


async def get_plans(session: AsyncSession) -> list[dict]:
    keys = [f"token_plan_{p}_{suffix}" for p in PLAN_KEYS for suffix in ("price", "amount")]
    constants = await get_pricing_constants(session, keys)
    return [
        {
            "plan_key": plan,
            "price": constants[f"token_plan_{plan}_price"],
            "token_amount": constants[f"token_plan_{plan}_amount"],
        }
        for plan in PLAN_KEYS
    ]


async def create_token_order(session: AsyncSession, user: User, plan_key: str) -> dict:
    constants = await get_pricing_constants(
        session, [f"token_plan_{plan_key}_price", f"token_plan_{plan_key}_amount"]
    )
    price = constants[f"token_plan_{plan_key}_price"]
    token_amount = constants[f"token_plan_{plan_key}_amount"]
    if price <= 0 or token_amount <= 0:
        raise DomainError("토큰 플랜이 올바르지 않습니다", code="invalid_plan")

    order = Order(
        user_id=user.id,
        order_number=await generate_number(session, Order.order_number, "TKN"),
        order_type="token",
        status="대기중",
        shipping_address_id=None,
        original_price=price,
        total_price=price,
        payment_group_id=uuid.uuid4(),
    )
    session.add(order)
    await session.flush()
    session.add(
        OrderItem(
            order_id=order.id,
            item_id=f"token-order-{order.id}",
            item_type="token",
            item_data={"plan_key": plan_key, "token_amount": token_amount},
            quantity=1,
            unit_price=price,
        )
    )
    await session.commit()
    return {
        "order_id": order.id,
        "order_number": order.order_number,
        "payment_group_id": order.payment_group_id,
        "price": price,
        "token_amount": token_amount,
    }


# ---- 환불 ----


async def _granted_rows(session: AsyncSession, order: Order) -> list[DesignToken]:
    rows = await session.scalars(
        select(DesignToken).where(
            DesignToken.user_id == order.user_id,
            DesignToken.type == "purchase",
            DesignToken.token_class == "paid",
            or_(
                DesignToken.source_order_id == order.id,
                DesignToken.work_id.in_([f"order_{order.id}", f"order_{order.id}_paid"]),
            ),
        )
    )
    return list(rows)


async def list_refundable_orders(session: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    orders = (
        await session.scalars(
            select(Order)
            .where(
                Order.user_id == user_id,
                Order.order_type == "token",
                or_(
                    Order.status == "완료",
                    exists().where(
                        Claim.order_id == Order.id,
                        Claim.type == "token_refund",
                        Claim.status == "완료",
                    ),
                ),
            )
            .order_by(Order.created_at.desc(), Order.id.desc())
        )
    ).all()

    latest_completed_order_id = next((order.id for order in orders if order.status == "완료"), None)
    results = []
    for order in orders:
        granted = await _granted_rows(session, order)
        paid_granted = sum(t.amount for t in granted)
        expires = granted[0].expires_at if granted else None
        granted_at = min((t.created_at for t in granted), default=None)

        claim_row = (
            await session.execute(
                select(Claim.id, Claim.status)
                .where(
                    Claim.order_id == order.id,
                    Claim.type == "token_refund",
                    Claim.status.in_(("접수", "완료")),
                )
                .order_by(Claim.created_at.desc(), Claim.id.desc())
                .limit(1)
            )
        ).first()
        claim_id = claim_row.id if claim_row is not None else None
        claim_status = claim_row.status if claim_row is not None else None

        reason: str | None = None
        if claim_status == "접수":
            reason = "pending_refund"
        elif claim_status == "완료":
            reason = "approved_refund"
        elif expires is not None and expires <= datetime.now(UTC):
            reason = "expired"
        elif order.id != latest_completed_order_id:
            reason = "not_latest"
        elif granted_at is not None and await session.scalar(
            select(
                exists().where(
                    DesignToken.user_id == user_id,
                    DesignToken.type == "use",
                    DesignToken.created_at > granted_at,
                )
            )
        ):
            reason = "tokens_used"

        results.append(
            {
                "order_id": order.id,
                "order_number": order.order_number,
                "total_price": order.total_price,
                "paid_tokens_granted": paid_granted,
                "token_expires_at": expires,
                "is_refundable": reason is None and paid_granted > 0,
                "reason": reason,
                "claim_id": claim_id,
            }
        )
    return results


async def request_refund(session: AsyncSession, user: User, order_id: uuid.UUID) -> dict:
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user.id))
    order = await session.scalar(
        select(Order).where(Order.id == order_id, Order.user_id == user.id).with_for_update()
    )
    if order is None:
        raise NotFoundError("주문을 찾을 수 없습니다")
    if order.order_type != "token" or order.status != "완료":
        raise DomainError("환불할 수 없는 주문입니다", code="not_refundable")

    granted = await _granted_rows(session, order)
    paid_granted = sum(t.amount for t in granted)
    if paid_granted <= 0:
        raise DomainError("no paid tokens found", code="not_refundable")
    expires = granted[0].expires_at if granted else None
    if expires is not None and expires <= datetime.now(UTC):
        raise DomainError("token_order_expired", code="token_order_expired")

    latest_id = await session.scalar(
        select(Order.id)
        .where(Order.user_id == user.id, Order.order_type == "token", Order.status == "완료")
        .order_by(Order.created_at.desc(), Order.id.desc())
        .limit(1)
    )
    if latest_id != order.id:
        raise DomainError("not the latest order", code="not_latest_order")

    granted_at = min(t.created_at for t in granted)
    used_after = await session.scalar(
        select(
            exists().where(
                DesignToken.user_id == user.id,
                DesignToken.type == "use",
                DesignToken.created_at > granted_at,
            )
        )
    )
    if used_after:
        raise DomainError("tokens_used_after_order", code="tokens_used")

    duplicate = await session.scalar(
        select(
            exists().where(
                Claim.order_id == order.id,
                Claim.type == "token_refund",
                Claim.status != "거부",
            )
        )
    )
    if duplicate:
        raise DomainError("duplicate_refund_request", code="duplicate_refund")

    order_item_id = await session.scalar(select(OrderItem.id).where(OrderItem.order_id == order.id))
    claim = Claim(
        user_id=user.id,
        order_id=order.id,
        order_item_id=order_item_id,
        claim_number=f"TKR-{datetime.now(UTC):%Y%m%d%H%M%S}-{uuid.uuid4().hex[:4]}",
        type="token_refund",
        status="접수",
        reason="token_refund",
        quantity=1,
        refund_data={
            "paid_token_amount": paid_granted,
            "bonus_token_amount": 0,
            "refund_amount": order.total_price,
        },
    )
    session.add(claim)
    await session.commit()
    return {
        "claim_id": claim.id,
        "claim_number": claim.claim_number,
        "refund_amount": order.total_price,
        "paid_token_amount": paid_granted,
        "bonus_token_amount": 0,
    }


async def cancel_refund_request(session: AsyncSession, user: User, claim_id: uuid.UUID) -> None:
    from api.deps import ensure_owner

    claim = await session.scalar(
        select(Claim).where(Claim.id == claim_id, Claim.type == "token_refund").with_for_update()
    )
    ensure_owner(claim, user)
    assert claim is not None
    if claim.status != "접수":
        raise DomainError("only pending requests can be cancelled", code="invalid_status")
    has_open_operation = await session.scalar(
        select(
            exists().where(
                PaymentIncident.claim_id == claim.id,
                PaymentIncident.incident_type == "refund",
                PaymentIncident.status == "open",
            )
        )
    )
    if has_open_operation:
        raise ConflictError(
            "환불 처리가 진행 중이거나 대사가 필요합니다",
            code="payment_reconciliation_required",
        )
    session.add(
        ClaimStatusLog(
            claim_id=claim.id,
            changed_by=user.id,
            previous_status=claim.status,
            new_status="거부",
            memo="고객 환불 요청 취소",
            request_id=request_id_var.get() or None,
        )
    )
    claim.status = "거부"
    await session.commit()


def _refund_values(claim: Claim) -> tuple[int, int, int]:
    data = claim.refund_data or {}
    paid = data.get("paid_token_amount")
    bonus = data.get("bonus_token_amount", 0)
    refund_amount = data.get("refund_amount")
    if (
        not isinstance(paid, int)
        or not isinstance(bonus, int)
        or not isinstance(refund_amount, int)
        or paid < 0
        or bonus < 0
        or refund_amount <= 0
    ):
        raise DomainError(
            "환불 데이터가 올바르지 않습니다",
            code="invalid_refund_data",
            status=422,
        )
    return paid, bonus, refund_amount


async def _apply_token_refund(
    session: AsyncSession,
    *,
    claim: Claim,
    order: Order,
    actor_id: uuid.UUID,
    paid: int,
    bonus: int,
    operation_id: uuid.UUID | None = None,
) -> None:
    granted = await _granted_rows(session, order)
    expires = granted[0].expires_at if granted else None
    if paid > 0:
        await session.execute(
            _idempotent_insert(
                dict(
                    user_id=claim.user_id,
                    amount=-paid,
                    type="refund",
                    token_class="paid",
                    work_id=f"refund_{claim.id}_paid",
                    source_order_id=order.id,
                    expires_at=expires,
                )
            )
        )
    if bonus > 0:
        await session.execute(
            _idempotent_insert(
                dict(
                    user_id=claim.user_id,
                    amount=-bonus,
                    type="refund",
                    token_class="bonus",
                    work_id=f"refund_{claim.id}_bonus",
                )
            )
        )
    if order.status != "취소":
        from api.domains.orders.service import log_status

        log_status(session, order, "취소", changed_by=actor_id, memo="토큰 환불 승인")
    if claim.status != "완료":
        session.add(
            ClaimStatusLog(
                claim_id=claim.id,
                changed_by=actor_id,
                previous_status=claim.status,
                new_status="완료",
                request_id=request_id_var.get() or None,
            )
        )
        claim.status = "완료"
    await session.execute(
        pg_insert(ClaimNotificationLog)
        .values(
            claim_id=claim.id,
            status="완료",
            delivery_status="pending",
            attempts=0,
        )
        .on_conflict_do_nothing(
            index_elements=[ClaimNotificationLog.claim_id, ClaimNotificationLog.status]
        )
    )
    if operation_id is not None:
        await set_payment_operation_outcome(
            session,
            operation_id,
            phase="applied",
            status="resolved",
            resolved_by=actor_id,
            resolution_memo="provider refund applied",
            observed_amount=(claim.refund_data or {}).get("refund_amount"),
        )
    await session.commit()


async def reconcile_approved_refund(
    session: AsyncSession,
    *,
    claim_id: uuid.UUID,
    actor_id: uuid.UUID,
) -> tuple[bool, str]:
    """검증된 Toss 취소 결과를 토큰 원장·주문·클레임에 멱등 반영한다."""
    user_id = await session.scalar(
        select(Claim.user_id).where(Claim.id == claim_id, Claim.type == "token_refund")
    )
    if user_id is None:
        await session.commit()
        return False, "missing_token_refund_claim"
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user_id))
    claim = await session.scalar(
        select(Claim)
        .where(Claim.id == claim_id, Claim.type == "token_refund")
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if claim is None:
        await session.commit()
        return False, "missing_token_refund_claim"
    if claim.status not in ("접수", "완료"):
        await session.commit()
        return False, "token_refund_claim_not_applicable"
    order = await session.scalar(
        select(Order)
        .where(Order.id == claim.order_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if order is None or order.status not in ("완료", "취소"):
        await session.commit()
        return False, "token_refund_order_not_applicable"
    paid, bonus, refund_amount = _refund_values(claim)
    if refund_amount > order.total_price:
        await session.commit()
        return False, "invalid_refund_amount"
    already_consistent = claim.status == "완료" and order.status == "취소"
    await _apply_token_refund(
        session,
        claim=claim,
        order=order,
        actor_id=actor_id,
        paid=paid,
        bonus=bonus,
    )
    return True, "already_consistent" if already_consistent else "applied"


async def token_refund_is_consistent(
    session: AsyncSession,
    *,
    claim_id: uuid.UUID,
) -> bool:
    claim = await session.scalar(
        select(Claim)
        .where(Claim.id == claim_id, Claim.type == "token_refund")
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if claim is None or claim.status != "완료":
        return False
    order = await session.scalar(
        select(Order)
        .where(Order.id == claim.order_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if order is None or order.status != "취소":
        return False
    paid, bonus, _ = _refund_values(claim)
    work_ids = (f"refund_{claim.id}_paid", f"refund_{claim.id}_bonus")
    rows = list(await session.scalars(select(DesignToken).where(DesignToken.work_id.in_(work_ids))))
    amounts = {row.work_id: row.amount for row in rows}
    return (paid == 0 or amounts.get(work_ids[0]) == -paid) and (
        bonus == 0 or amounts.get(work_ids[1]) == -bonus
    )


async def approve_refund(
    session: AsyncSession, admin: User, toss: TossClient, claim_id: uuid.UUID
) -> dict:
    claim_user_id = await session.scalar(
        select(Claim.user_id).where(Claim.id == claim_id, Claim.type == "token_refund")
    )
    if claim_user_id is None:
        raise NotFoundError("환불 요청을 찾을 수 없습니다")
    await advisory_xact_lock(session, USER_LOCK.format(user_id=claim_user_id))
    claim = await session.scalar(
        select(Claim).where(Claim.id == claim_id, Claim.type == "token_refund").with_for_update()
    )
    if claim is None:
        raise NotFoundError("환불 요청을 찾을 수 없습니다")
    paid, bonus, refund_amount = _refund_values(claim)

    if claim.status == "완료":
        return {"success": True, "already_approved": True}  # 멱등
    if claim.status != "접수":
        raise ConflictError("접수 상태의 환불 요청만 승인할 수 있습니다", code="invalid_status")

    order = await session.scalar(select(Order).where(Order.id == claim.order_id).with_for_update())
    if order is None or not order.payment_key:
        raise ConflictError("결제 정보가 없습니다", code="missing_payment_key")
    if refund_amount > order.total_price:
        raise DomainError("환불 금액이 결제 금액을 초과합니다", code="invalid_refund_amount")
    has_open_incident = await session.scalar(
        select(
            exists().where(
                PaymentIncident.claim_id == claim.id,
                PaymentIncident.incident_type == "refund",
                PaymentIncident.status == "open",
            )
        )
    )
    if has_open_incident:
        raise ConflictError(
            "환불 결과 대사가 필요한 요청입니다",
            code="payment_reconciliation_required",
        )

    cancel_amount = refund_amount if refund_amount < order.total_price else None  # 생략=전액
    payment_key = order.payment_key
    refund_order_id = order.id
    assert payment_key is not None
    operation = prepare_payment_operation(
        session,
        incident_type="refund",
        actor_id=admin.id,
        order_id=order.id,
        claim_id=claim.id,
        expected_amount=refund_amount,
        details={
            "payment_group_id": str(order.payment_group_id),
            "lookup_payment_key": payment_key,
        },
    )
    # 환불 대상 잠금과 operation journal을 Toss 호출 전에 durable하게 만든다.
    await session.commit()
    operation_id = operation.id
    try:
        result = await toss.cancel(payment_key, "고객 토큰 환불 요청", cancel_amount)
    except Exception as exc:
        await persist_payment_operation_outcome(
            session,
            operation_id=operation_id,
            phase="cancel_outcome_unknown",
            error_type=type(exc).__name__,
        )
        raise UpstreamError(
            "결제 취소 결과를 확인할 수 없어 관리자 대사가 필요합니다",
            code="payment_outcome_unknown",
        ) from exc
    if not result.ok:
        if result.status >= 500:
            await persist_payment_operation_outcome(
                session,
                operation_id=operation_id,
                phase="provider_response_uncertain",
                error_type="provider_server_error",
                provider_http_status=result.status,
            )
            raise UpstreamError(
                "결제 취소 결과를 확인할 수 없어 관리자 대사가 필요합니다",
                code="payment_outcome_unknown",
            )
        await set_payment_operation_outcome(
            session,
            operation_id,
            phase="provider_rejected",
            status="resolved",
            resolved_by=admin.id,
            resolution_memo="provider rejected refund",
            provider_http_status=result.status,
            provider_status=(
                result.body.get("status") if isinstance(result.body.get("status"), str) else None
            ),
        )
        await session.commit()
        raise DomainError(
            result.body.get("message", "결제 취소에 실패했습니다"),
            code=result.body.get("code", "toss_error"),
            status=result.status if 400 <= result.status < 600 else 502,
        )

    try:
        await advisory_xact_lock(session, USER_LOCK.format(user_id=claim_user_id))
        claim = await session.scalar(
            select(Claim)
            .where(Claim.id == claim_id, Claim.type == "token_refund")
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if claim is None or claim.status != "접수":
            raise ConflictError(
                "환불 요청 상태가 외부 취소 중 변경되었습니다",
                code="payment_reconciliation_required",
            )
        order = await session.scalar(
            select(Order)
            .where(Order.id == claim.order_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if order is None or order.status != "완료":
            raise ConflictError(
                "주문 상태가 외부 취소 중 변경되었습니다",
                code="payment_reconciliation_required",
            )
        await _apply_token_refund(
            session,
            claim=claim,
            order=order,
            actor_id=admin.id,
            paid=paid,
            bonus=bonus,
            operation_id=operation_id,
        )
    except Exception as exc:
        logger.critical(
            "Toss 취소 성공 후 DB 반영 실패 — 수동 개입 필요: claim_id=%s order_id=%s",
            claim_id,
            refund_order_id,
        )
        provider_status = result.body.get("status")
        await persist_payment_operation_outcome(
            session,
            operation_id=operation_id,
            phase="provider_succeeded_db_failed",
            error_type=type(exc).__name__,
            provider_http_status=result.status,
            provider_status=provider_status if isinstance(provider_status, str) else None,
        )
        raise UpstreamError(
            "결제는 취소됐지만 환불 반영에 실패해 관리자 대사가 필요합니다",
            code="payment_reconciliation_required",
        ) from exc
    return {"success": True, "already_approved": False}


async def admin_manage(
    session: AsyncSession,
    admin: User,
    operation_id: uuid.UUID,
    user_id: uuid.UUID,
    amount: int,
    description: str,
) -> dict:
    if amount == 0:
        raise DomainError("amount는 0일 수 없습니다", code="invalid_amount")
    if not description.strip():
        raise DomainError("description은 필수입니다", code="description_required")
    payload = {
        "user_id": str(user_id),
        "amount": amount,
        "description": description.strip(),
    }
    previous = await idempotent_result(
        session,
        operation_id=operation_id,
        action="token_adjust",
        target_type="customer",
        target_id=str(user_id),
        payload=payload,
    )
    if previous is not None:
        return {
            "success": True,
            "new_balance": int(previous["new_balance"]),
            "operation_id": operation_id,
        }
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user_id))
    target = await session.scalar(
        select(User)
        .where(User.id == user_id, User.role == "customer", User.is_active.is_(True))
        .with_for_update()
    )
    if target is None:
        raise NotFoundError("활성 고객을 찾을 수 없습니다")
    if amount < 0:
        # 유저 advisory/row lock으로 앱 쓰기를 직렬화하고, 이미 진행 중인 원장
        # 갱신과도 잔액 스냅샷이 섞이지 않도록 원장 행을 함께 잠근다.
        await session.execute(
            select(DesignToken.id)
            .where(DesignToken.user_id == user_id, _not_expired)
            .with_for_update()
        )
        batches = await _get_spendable_batches(session, user_id)
        balance = _summarize_batches(batches)
        if balance["total"] < -amount:
            raise DomainError("insufficient_tokens", code="insufficient_tokens")
        await _insert_bucketed_debits(
            session,
            user_id=user_id,
            amount=-amount,
            entry_type="admin",
            batches=batches,
            work_id_for=lambda token_class, batch_index: (
                f"admin_{operation_id}_{token_class}_{batch_index}"
            ),
            description=description.strip(),
        )
    else:
        balance = await get_balance(session, user_id)
        session.add(
            DesignToken(
                user_id=user_id,
                amount=amount,
                type="admin",
                token_class="paid",
                description=description.strip(),
                work_id=f"admin_{operation_id}",
            )
        )
    new_balance = balance["total"] + amount
    record_operation(
        session,
        operation_id=operation_id,
        actor_id=admin.id,
        action="token_adjust",
        target_type="customer",
        target_id=str(user_id),
        target_count=1,
        reason=description,
        payload=payload,
        before={"balance": balance["total"]},
        after={"new_balance": new_balance, "amount": amount},
        request_id=request_id_var.get(),
    )
    await session.commit()
    return {
        "success": True,
        "new_balance": new_balance,
        "operation_id": operation_id,
    }
