import uuid

from db.models.commerce import Claim
from fastapi import APIRouter, BackgroundTasks, Request
from sqlalchemy import select

from api.db import SessionDep
from api.deps import AdminUser, CurrentUser
from api.domains.claims import service
from api.domains.claims.schemas import (
    AdminClaimStatusRequest,
    AdminClaimStatusResponse,
    ClaimCreateRequest,
    ClaimOut,
)

router = APIRouter(tags=["claims"])


@router.post("/claims", response_model=ClaimOut, status_code=201)
async def create_claim(
    body: ClaimCreateRequest, session: SessionDep, user: CurrentUser
) -> ClaimOut:
    return ClaimOut.model_validate(await service.create_claim(session, user, body))


@router.get("/claims", response_model=list[ClaimOut])
async def list_my_claims(session: SessionDep, user: CurrentUser) -> list[ClaimOut]:
    claims = await session.scalars(
        select(Claim).where(Claim.user_id == user.id).order_by(Claim.created_at.desc())
    )
    return [ClaimOut.model_validate(c) for c in claims]


@router.delete("/claims/{claim_id}", status_code=204)
async def cancel_claim(claim_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    await service.cancel_claim(session, user, claim_id)


# ---- 관리자 ----


@router.get("/admin/claims", response_model=list[ClaimOut])
async def admin_list_claims(session: SessionDep, admin: AdminUser) -> list[ClaimOut]:
    claims = await session.scalars(select(Claim).order_by(Claim.created_at.desc()))
    return [ClaimOut.model_validate(c) for c in claims]


@router.post("/admin/claims/{claim_id}/status", response_model=AdminClaimStatusResponse)
async def admin_update_claim_status(
    claim_id: uuid.UUID,
    body: AdminClaimStatusRequest,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
    background: BackgroundTasks,
) -> AdminClaimStatusResponse:
    result = await service.admin_update_status(
        session, admin, claim_id, body.new_status, body.memo, body.is_rollback
    )
    # 롤백이 아닌 완료/거부 전이만 알림 (실패해도 상태 변경엔 영향 없음 — best effort)
    if not body.is_rollback and body.new_status in ("완료", "거부"):
        app = request.app

        async def _notify() -> None:
            async with app.state.sessionmaker() as notify_session:
                await service.notify_status(
                    notify_session, app.state.solapi, app.state.settings, claim_id
                )

        background.add_task(_notify)
    return AdminClaimStatusResponse(**result)
