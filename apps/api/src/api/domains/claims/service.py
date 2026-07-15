"""클레임 — 생성 가드·상태기계·알림 (docs/api-spec/domains.md §4)."""

import logging
import uuid
from datetime import UTC, datetime

from db.models.auth import User
from db.models.commerce import Claim, ClaimNotificationLog, ClaimStatusLog, Order, OrderItem
from obs import request_id_var
from sqlalchemy import delete, exists, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import Settings
from api.db import advisory_xact_lock
from api.domains.claims.schemas import ClaimCreateRequest
from api.domains.orders.status_machine import (
    ACTIVE_CLAIM_STATUSES,
    CLAIM_CANCEL_ACTION_FROM,
    CLAIM_RETURN_EXCHANGE_ACTION_FROM,
)
from api.errors import ConflictError, DomainError, NotFoundError
from api.integrations.solapi import SolapiClient
from api.numbering import generate_number

logger = logging.getLogger(__name__)

FORWARD_CLAIM: dict[str, set[tuple[str, str]]] = {
    "cancel": {("접수", "처리중"), ("처리중", "완료")},
    "return": {("접수", "수거요청"), ("수거요청", "수거완료"), ("수거완료", "완료")},
    "exchange": {
        ("접수", "수거요청"),
        ("수거요청", "수거완료"),
        ("수거완료", "재발송"),
        ("재발송", "완료"),
    },
    "token_refund": set(),  # 완료는 환불 승인 플로우 전용
}

REJECTABLE_FROM: dict[str, set[str]] = {
    "cancel": {"접수", "처리중"},
    "return": {"접수", "수거요청", "수거완료"},
    "exchange": {"접수", "수거요청", "수거완료", "재발송"},
    "token_refund": {"접수"},
}

# 롤백 — 공통 거부→접수 + 타입별
ROLLBACK_CLAIM: dict[str, set[tuple[str, str]]] = {
    "cancel": {("거부", "접수"), ("처리중", "접수")},
    "return": {("거부", "접수"), ("수거요청", "접수")},
    "exchange": {("거부", "접수"), ("수거요청", "접수")},
    "token_refund": {("거부", "접수")},
}


async def create_claim(session: AsyncSession, user: User, body: ClaimCreateRequest) -> Claim:
    await advisory_xact_lock(session, f"order:{body.order_id}")
    order = await session.scalar(
        select(Order).where(Order.id == body.order_id, Order.user_id == user.id)
    )
    if order is None:
        raise NotFoundError("Order not found")

    completed_cancel = await session.scalar(
        select(
            exists().where(
                Claim.order_id == order.id,
                Claim.type == "cancel",
                Claim.status == "완료",
            )
        )
    )
    if completed_cancel:
        raise DomainError(
            "완료된 취소 클레임이 있는 주문은 새 클레임을 신청할 수 없습니다",
            code="completed_cancel_claim",
        )

    if body.type == "cancel":
        if order.status not in CLAIM_CANCEL_ACTION_FROM.get(order.order_type, set()):
            raise DomainError("현재 주문 상태에서는 취소할 수 없습니다", code="invalid_status")
    else:  # return/exchange
        if order.status not in CLAIM_RETURN_EXCHANGE_ACTION_FROM.get(order.order_type, set()):
            raise DomainError("현재 주문 상태에서는 반품/교환할 수 없습니다", code="invalid_status")

    items = (
        await session.scalars(
            select(OrderItem).where(
                OrderItem.order_id == order.id, OrderItem.item_id == body.item_id
            )
        )
    ).all()
    if not items:
        raise NotFoundError("Order item not found")
    if len(items) > 1:
        raise ConflictError("Multiple order items found", code="ambiguous_item")
    item = items[0]

    quantity = body.quantity if body.quantity is not None else item.quantity
    if quantity <= 0 or quantity > item.quantity:
        raise DomainError("Invalid claim quantity", code="invalid_quantity")

    has_active = await session.scalar(
        select(exists().where(Claim.order_id == order.id, Claim.status.in_(ACTIVE_CLAIM_STATUSES)))
    )
    if has_active:
        raise ConflictError("Active claim already exists for this order", code="active_claim")

    claim = Claim(
        user_id=user.id,
        order_id=order.id,
        order_item_id=item.id,
        claim_number=await generate_number(session, Claim.claim_number, "CLM"),
        type=body.type,
        status="접수",
        reason=body.reason,
        description=body.description,
        quantity=quantity,
    )
    session.add(claim)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if "uq_claims_single_active_per_order" in str(exc.orig):
            raise ConflictError(
                "Active claim already exists for this order", code="active_claim"
            ) from exc
        raise ConflictError(
            "Claim already exists for this item and type", code="duplicate_claim"
        ) from exc
    await session.refresh(claim)
    return claim


async def cancel_claim(session: AsyncSession, user: User, claim_id: uuid.UUID) -> None:
    from api.deps import ensure_owner

    claim = await session.scalar(select(Claim).where(Claim.id == claim_id).with_for_update())
    ensure_owner(claim, user)
    assert claim is not None
    if claim.type == "token_refund":
        raise DomainError(
            "token_refund 클레임은 직접 취소할 수 없습니다", code="invalid_claim_type"
        )
    if claim.status != "접수":
        raise DomainError("접수 상태에서만 클레임을 취소할 수 있습니다", code="invalid_status")
    await session.execute(delete(Claim).where(Claim.id == claim.id))
    await session.commit()


async def admin_update_status(
    session: AsyncSession,
    admin: User,
    claim_id: uuid.UUID,
    new_status: str,
    memo: str | None,
    is_rollback: bool,
) -> dict:
    claim = await session.scalar(select(Claim).where(Claim.id == claim_id).with_for_update())
    if claim is None:
        raise NotFoundError("Claim not found")
    if claim.status == new_status:
        raise ConflictError(f"Status is already {new_status}", code="same_status")

    if is_rollback:
        if not (memo and memo.strip()):
            raise DomainError("롤백 시 사유 입력 필수", code="memo_required")
        if (claim.status, new_status) not in ROLLBACK_CLAIM[claim.type]:
            raise DomainError(
                f'Invalid rollback from "{claim.status}" to "{new_status}" for {claim.type} claim',
                code="invalid_rollback",
            )
    else:
        allowed = (claim.status, new_status) in FORWARD_CLAIM[claim.type] or (
            new_status == "거부" and claim.status in REJECTABLE_FROM[claim.type]
        )
        if not allowed:
            raise DomainError(
                f'Invalid transition from "{claim.status}" to "{new_status}" '
                f"for {claim.type} claim",
                code="invalid_transition",
            )

    # 비활성 → 활성 재진입 시 주문당 단일 활성 가드 재검사
    if claim.status not in ACTIVE_CLAIM_STATUSES and new_status in ACTIVE_CLAIM_STATUSES:
        other_active = await session.scalar(
            select(
                exists().where(
                    Claim.order_id == claim.order_id,
                    Claim.id != claim.id,
                    Claim.status.in_(ACTIVE_CLAIM_STATUSES),
                )
            )
        )
        if other_active:
            raise ConflictError("Active claim already exists for this order", code="active_claim")

    previous = claim.status
    session.add(
        ClaimStatusLog(
            claim_id=claim.id,
            changed_by=admin.id,
            previous_status=previous,
            new_status=new_status,
            memo=memo,
            is_rollback=is_rollback,
            request_id=request_id_var.get() or None,
        )
    )
    claim.status = new_status
    if not is_rollback and new_status in ("완료", "거부"):
        await session.execute(
            pg_insert(ClaimNotificationLog)
            .values(
                claim_id=claim.id,
                status=new_status,
                delivery_status="pending",
                attempts=0,
            )
            .on_conflict_do_nothing(
                index_elements=[ClaimNotificationLog.claim_id, ClaimNotificationLog.status]
            )
        )
    await session.commit()
    return {"success": True, "previous_status": previous, "new_status": new_status}


async def notify_status(
    session: AsyncSession,
    solapi: SolapiClient,
    settings: Settings,
    claim_id: uuid.UUID,
) -> str:
    """현재 terminal 상태의 outbox를 확보한 뒤 즉시 전송한다.

    정상 관리자 전이는 상태 변경 transaction에서 pending row를 먼저 만든다. 여기서의
    upsert는 migration 이전 terminal row와 테스트 fixture를 위한 복구 경로다.
    """
    claim = await session.get(Claim, claim_id)
    if claim is None or claim.status not in ("완료", "거부"):
        return "not_applicable"

    await session.execute(
        pg_insert(ClaimNotificationLog)
        .values(
            claim_id=claim.id,
            status=claim.status,
            delivery_status="pending",
            attempts=0,
        )
        .on_conflict_do_nothing(
            index_elements=[ClaimNotificationLog.claim_id, ClaimNotificationLog.status]
        )
    )
    notification_id = await session.scalar(
        select(ClaimNotificationLog.id).where(
            ClaimNotificationLog.claim_id == claim.id,
            ClaimNotificationLog.status == claim.status,
        )
    )
    assert notification_id is not None
    return await deliver_notification(session, solapi, settings, notification_id)


async def deliver_notification(
    session: AsyncSession,
    solapi: SolapiClient,
    settings: Settings,
    notification_id: uuid.UUID,
) -> str:
    """outbox 1건을 잠가 전송한다. sent/skipped는 terminal이라 재전송하지 않는다."""
    notification = await session.scalar(
        select(ClaimNotificationLog)
        .where(ClaimNotificationLog.id == notification_id)
        .with_for_update()
    )
    if notification is None:
        raise NotFoundError("Claim notification not found")
    if notification.delivery_status == "sent":
        return "already_sent"
    if notification.delivery_status == "skipped":
        return "already_skipped"

    claim = await session.get(Claim, notification.claim_id)
    if claim is None or claim.status != notification.status or claim.status not in ("완료", "거부"):
        notification.delivery_status = "skipped"
        notification.last_error = "claim_status_changed"
        await session.commit()
        return "claim_status_changed"

    user = await session.get(User, claim.user_id)
    if user is None or not (
        user.notification_consent
        and user.phone_verified
        and user.notification_enabled
        and user.phone
    ):
        notification.delivery_status = "skipped"
        notification.last_error = "recipient_opted_out"
        await session.commit()
        return "recipient_opted_out"

    if claim.status == "완료":
        template = settings.solapi_template_claim_done
        variables = {"#{처리유형}": claim.type}
        fallback = "[ESSE SION] 클레임이 처리 완료되었습니다.\nhttps://essesion.shop/my-page/claims"
    else:
        template = settings.solapi_template_claim_rejected
        variables = {}
        fallback = (
            "[ESSE SION] 클레임 요청이 거부되었습니다. 자세한 내용은 아래 링크에서 확인해주세요."
            "\nhttps://essesion.shop/my-page/claims"
        )

    notification.attempts += 1
    try:
        sent = await solapi.send_alimtalk(user.phone, template, variables, fallback)
    except Exception as exc:  # 외부 client 구현은 False 계약이지만 예외도 outbox에 남긴다.
        logger.exception("claim notification delivery raised: notification_id=%s", notification.id)
        sent = False
        notification.last_error = f"delivery_exception:{type(exc).__name__}"
    if not sent:
        notification.delivery_status = "failed"
        notification.last_error = notification.last_error or "solapi_delivery_failed"
        await session.commit()
        return "delivery_failed"

    notification.delivery_status = "sent"
    notification.last_error = None
    notification.sent_at = datetime.now(UTC)
    await session.commit()
    return "sent"
