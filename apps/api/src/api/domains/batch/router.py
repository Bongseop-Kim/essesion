"""배치 — Cloud Scheduler가 호출 (money.md §7). 로컬은 batch_token Bearer로 수동 실행."""

from datetime import UTC, datetime, timedelta

from db.models.commerce import Claim, Order
from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import and_, exists, not_, or_, select

from api.db import SessionDep
from api.deps import BatchAuth
from api.domains.orders.service import log_status
from api.domains.orders.status_machine import ACTIVE_CLAIM_STATUSES

router = APIRouter(prefix="/batch", tags=["batch"], dependencies=[BatchAuth])

AUTO_CONFIRM_AFTER = timedelta(days=7)
STALE_PENDING_AFTER = timedelta(minutes=30)


class BatchResult(BaseModel):
    processed: int


def _no_active_claim():
    return not_(
        exists().where(Claim.order_id == Order.id, Claim.status.in_(ACTIVE_CLAIM_STATUSES))
    )


@router.post("/auto-confirm-orders", response_model=BatchResult)
async def auto_confirm_orders(session: SessionDep) -> BatchResult:
    """배송완료/배송중 7일 경과 주문 자동 구매확정 (활성 클레임 제외)."""
    cutoff = datetime.now(UTC) - AUTO_CONFIRM_AFTER
    shipped_at_ref = or_(
        and_(Order.order_type == "repair", Order.company_shipped_at <= cutoff),
        and_(Order.order_type != "repair", Order.shipped_at <= cutoff),
    )
    orders = (
        await session.scalars(
            select(Order)
            .where(
                or_(
                    and_(Order.status == "배송완료", Order.delivered_at <= cutoff),
                    and_(Order.status == "배송중", shipped_at_ref),
                ),
                _no_active_claim(),
            )
            .with_for_update(skip_locked=True)
        )
    ).all()
    for order in orders:
        basis = "배송완료" if order.status == "배송완료" else "발송"
        log_status(
            session, order, "완료", changed_by=None, memo=f"자동 구매확정 ({basis} 후 7일 경과)"
        )
        order.confirmed_at = datetime.now(UTC)
    await session.commit()
    return BatchResult(processed=len(orders))


@router.post("/cancel-stale-orders", response_model=BatchResult)
async def cancel_stale_orders(session: SessionDep) -> BatchResult:
    """대기중 30분 초과 주문 자동 취소."""
    cutoff = datetime.now(UTC) - STALE_PENDING_AFTER
    orders = (
        await session.scalars(
            select(Order)
            .where(Order.status == "대기중", Order.created_at < cutoff)
            .with_for_update(skip_locked=True)
        )
    ).all()
    for order in orders:
        log_status(session, order, "취소", changed_by=None, memo="자동 취소 (대기중 30분 초과)")
    await session.commit()
    return BatchResult(processed=len(orders))
