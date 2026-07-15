"""배치 — Cloud Scheduler가 호출 (money.md §7). 로컬은 batch_token Bearer로 수동 실행."""

from datetime import UTC, datetime, timedelta

from db.models.commerce import Claim, Order
from db.models.design import (
    FINALIZE_STALE_MESSAGE,
    FINALIZE_TEMPORARY_FAILURE_MARKER,
    DesignSession,
    GenerationJob,
)
from db.models.images import Image
from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import and_, exists, func, not_, or_, select, update

from api.db import SessionDep
from api.deps import BatchAuth
from api.domains.orders.service import log_status, restore_reserved_order_coupons
from api.domains.orders.status_machine import ACTIVE_CLAIM_STATUSES

router = APIRouter(prefix="/batch", tags=["batch"], dependencies=[BatchAuth])

AUTO_CONFIRM_AFTER = timedelta(days=7)
STALE_PENDING_AFTER = timedelta(minutes=30)
CLEANUP_BATCH_SIZE = 100
CLEANUP_RETRY_AFTER = timedelta(minutes=5)
ORDER_BATCH_SIZE = 500
GENERATION_JOB_BATCH_SIZE = 100
# Cloud Tasks 최대 4회가 각 910초 deadline을 소진한 최악의 장기 실패까지 기다린 뒤,
# 남은 DB 상태를 다음 배치에서 회수한다.
STALE_GENERATION_JOB_AFTER = timedelta(minutes=75)
# worker finalize lease(960초)와 동일하게 최근 processing claim은 보호한다.
# 생성 TTL은 계속 진행되므로 transient 실패가 회수 시계를 리셋하지 않는다.
ACTIVE_GENERATION_JOB_LEASE = timedelta(seconds=960)


class BatchResult(BaseModel):
    processed: int


def _no_active_claim():
    return not_(exists().where(Claim.order_id == Order.id, Claim.status.in_(ACTIVE_CLAIM_STATUSES)))


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
            .order_by(Order.created_at, Order.id)
            .limit(ORDER_BATCH_SIZE)
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
            .order_by(Order.created_at, Order.id)
            .limit(ORDER_BATCH_SIZE)
            .with_for_update(skip_locked=True)
        )
    ).all()
    for order in orders:
        log_status(session, order, "취소", changed_by=None, memo="자동 취소 (대기중 30분 초과)")
    await restore_reserved_order_coupons(session, orders)
    await session.commit()
    return BatchResult(processed=len(orders))


@router.post("/reconcile-stale-generation-jobs", response_model=BatchResult)
async def reconcile_stale_generation_jobs(session: SessionDep) -> BatchResult:
    """Cloud Tasks 재시도 창을 넘긴 finalize job을 종료하고 세션 예산을 복구한다."""
    now = datetime.now(UTC)
    cutoff = now - STALE_GENERATION_JOB_AFTER
    active_lease_cutoff = now - ACTIVE_GENERATION_JOB_LEASE
    jobs = (
        await session.scalars(
            select(GenerationJob)
            .where(
                GenerationJob.kind == "finalize",
                GenerationJob.created_at < cutoff,
                or_(
                    GenerationJob.status == "queued",
                    and_(
                        GenerationJob.status == "processing",
                        GenerationJob.updated_at < active_lease_cutoff,
                    ),
                    and_(
                        GenerationJob.status == "failed",
                        GenerationJob.error_message == FINALIZE_TEMPORARY_FAILURE_MARKER,
                    ),
                ),
            )
            .order_by(GenerationJob.created_at, GenerationJob.id)
            .limit(GENERATION_JOB_BATCH_SIZE)
            .with_for_update(skip_locked=True)
        )
    ).all()

    for job in jobs:
        job.status = "failed"
        job.result = None
        job.error_message = FINALIZE_STALE_MESSAGE
        if job.session_id is not None:
            await session.execute(
                update(DesignSession)
                .where(DesignSession.id == job.session_id)
                .values(finalize_used=func.greatest(DesignSession.finalize_used - 1, 0))
            )
    await session.commit()
    return BatchResult(processed=len(jobs))


@router.post("/cleanup-images", response_model=BatchResult)
async def cleanup_images(session: SessionDep, request: Request) -> BatchResult:
    """만료·클레임된 이미지 2단계 삭제(claim → GCS 삭제 → finalize) — domains.md §8."""
    now = datetime.now(UTC)
    retry_before = now - CLEANUP_RETRY_AFTER
    targets = (
        await session.scalars(
            select(Image)
            .where(
                Image.deleted_at.is_(None),
                or_(
                    and_(Image.expires_at < now, Image.deletion_claimed_at.is_(None)),
                    Image.deletion_claimed_at < retry_before,
                ),
            )
            .order_by(func.coalesce(Image.deletion_claimed_at, Image.expires_at), Image.id)
            .limit(CLEANUP_BATCH_SIZE)
            .with_for_update(skip_locked=True)
        )
    ).all()

    for image in targets:
        # A fresh timestamp is both the claim lease and the retry cursor. Failed
        # objects move behind older work instead of monopolising every batch.
        image.deletion_claimed_at = now
    await session.commit()

    gcs = request.app.state.gcs
    processed = 0
    for image in targets:
        bucket_name = None
        if image.entity_type.startswith("product_"):
            settings = request.app.state.settings
            bucket_name = settings.gcs_assets_bucket or (
                "dry-run-product-assets" if settings.env in ("local", "test") else None
            )
        if await gcs.delete_object(
            image.object_key, bucket_name=bucket_name
        ):  # ② 스토리지 삭제 (멱등)
            image.deleted_at = datetime.now(UTC)  # ③ finalize (soft delete)
            processed += 1
    await session.commit()
    return BatchResult(processed=processed)
