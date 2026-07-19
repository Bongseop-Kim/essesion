"""배치 — Cloud Scheduler가 호출 (money.md §7). 로컬은 batch_token Bearer로 수동 실행."""

from datetime import UTC, datetime, timedelta

from db.models.commerce import Claim, Order
from db.models.design import GenerationJob
from db.models.images import Image
from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import and_, exists, func, not_, or_, select

from api.db import SessionDep
from api.deps import BatchAuth
from api.domains.design.job_lifecycle import (
    resolve_stale_finalize_jobs,
    stale_finalize_clause,
)
from api.domains.orders.service import log_status, restore_reserved_order_coupons
from api.domains.orders.status_machine import ACTIVE_CLAIM_STATUSES
from api.integrations.gcs import assets_bucket_name

router = APIRouter(prefix="/batch", tags=["batch"], dependencies=[BatchAuth])

AUTO_CONFIRM_AFTER = timedelta(days=7)
STALE_PENDING_AFTER = timedelta(minutes=30)
CLEANUP_BATCH_SIZE = 100
CLEANUP_RETRY_AFTER = timedelta(minutes=5)
ORDER_BATCH_SIZE = 500
GENERATION_JOB_BATCH_SIZE = 100


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
    """Cloud Tasks 재시도 창을 넘긴 finalize job을 canceled로 종결한다 — 쿼터 슬롯 자동 해제."""
    now = datetime.now(UTC)
    jobs = (
        await session.scalars(
            select(GenerationJob)
            .where(stale_finalize_clause(now))
            .order_by(GenerationJob.created_at, GenerationJob.id)
            .limit(GENERATION_JOB_BATCH_SIZE)
            .with_for_update(skip_locked=True)
        )
    ).all()

    resolve_stale_finalize_jobs(jobs)
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
        uses_assets_bucket = image.entity_type.startswith(("product_", "review_photo"))
        # 상품·후기 사진은 공개 assets 버킷 소속이다.
        bucket_name = assets_bucket_name(request.app.state.settings) if uses_assets_bucket else None
        if bucket_name is None and uses_assets_bucket:
            # assets 버킷 미설정이면 기본(비공개) 버킷을 지우게 되므로 건너뛴다.
            # claim은 유지되어 설정 후 재시도된다.
            continue
        if await gcs.delete_object(
            image.object_key, bucket_name=bucket_name
        ):  # ② 스토리지 삭제 (멱등)
            image.deleted_at = datetime.now(UTC)  # ③ finalize (soft delete)
            processed += 1
    await session.commit()
    return BatchResult(processed=processed)
