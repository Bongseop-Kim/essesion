"""디자인 세션 골격 — 세션 상태는 api 소유(LangGraph 대체), 워커 연동은 4단계.

예산 카운터(recraft_used/finalize_used)는 Postgres 공유 카운터 — 인스턴스 수와
무관하게 동작 (ARCHITECTURE §7). 턴 payload 스키마는 /design 신규 기획(5단계)에서 구체화.
"""

import uuid
from datetime import datetime
from typing import Any, cast

from db.models.design import DesignSession, DesignSessionTurn, GenerationJob
from fastapi import APIRouter, Request
from obs import request_id_var
from pydantic import BaseModel, ConfigDict
from sqlalchemy import CursorResult, func, select, update

from api.db import SessionDep, advisory_xact_lock
from api.deps import CurrentUser, ensure_owner
from api.errors import ConflictError

router = APIRouter(tags=["design"])


class DesignSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    seed: int | None
    colorway: str | None
    registry_version: str | None
    current_intent: dict[str, Any] | None
    recraft_used: int
    finalize_used: int
    created_at: datetime
    updated_at: datetime


class DesignSessionUpdateRequest(BaseModel):
    seed: int | None = None
    colorway: str | None = None
    current_intent: dict[str, Any] | None = None


class DesignTurnCreateRequest(BaseModel):
    role: str
    payload: dict[str, Any]


class DesignTurnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    seq: int
    role: str
    payload: dict[str, Any]
    created_at: datetime


class WorkerCandidateOut(BaseModel):
    id: str
    design_index: int
    layout_id: str
    source_fidelity: str
    colorway_id: str
    seed: int
    svg: str
    png_object_key: str | None


class DesignGenerateRequest(BaseModel):
    session_id: uuid.UUID | None = None
    prompt: str | None = None
    intent: dict[str, Any] | None = None
    colorway: str | None = None
    seed: int | None = None
    candidate_count: int = 1


class DesignGenerateOut(BaseModel):
    request_id: str
    registry_version: str
    engine_version: str
    candidates: list[WorkerCandidateOut]
    warnings: list[str] = []


class FinalizeRequest(BaseModel):
    intent: dict[str, Any] | None = None
    colorway_id: str | None = None
    production_method: str | None = None
    dpi: int | None = None


class GenerationJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID | None
    kind: str
    status: str
    params: dict[str, Any]
    result: dict[str, Any] | None
    error_message: str | None
    request_id: str | None
    attempts: int
    created_at: datetime
    updated_at: datetime


@router.post("/design/sessions", response_model=DesignSessionOut, status_code=201)
async def create_design_session(session: SessionDep, user: CurrentUser) -> DesignSessionOut:
    design_session = DesignSession(user_id=user.id)
    session.add(design_session)
    await session.commit()
    await session.refresh(design_session)
    return DesignSessionOut.model_validate(design_session)


@router.get("/design/sessions", response_model=list[DesignSessionOut])
async def list_design_sessions(session: SessionDep, user: CurrentUser) -> list[DesignSessionOut]:
    rows = await session.scalars(
        select(DesignSession)
        .where(DesignSession.user_id == user.id)
        .order_by(DesignSession.created_at.desc())
    )
    return [DesignSessionOut.model_validate(s) for s in rows]


@router.get("/design/sessions/{session_id}", response_model=DesignSessionOut)
async def get_design_session(
    session_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> DesignSessionOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    return DesignSessionOut.model_validate(design_session)


@router.patch("/design/sessions/{session_id}", response_model=DesignSessionOut)
async def update_design_session(
    session_id: uuid.UUID,
    body: DesignSessionUpdateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> DesignSessionOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(design_session, field, value)
    await session.commit()
    await session.refresh(design_session)
    return DesignSessionOut.model_validate(design_session)


@router.get("/design/sessions/{session_id}/turns", response_model=list[DesignTurnOut])
async def list_design_turns(
    session_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> list[DesignTurnOut]:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    rows = await session.scalars(
        select(DesignSessionTurn)
        .where(DesignSessionTurn.session_id == session_id)
        .order_by(DesignSessionTurn.seq)
    )
    return [DesignTurnOut.model_validate(t) for t in rows]


@router.post("/design/sessions/{session_id}/turns", response_model=DesignTurnOut, status_code=201)
async def append_design_turn(
    session_id: uuid.UUID,
    body: DesignTurnCreateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> DesignTurnOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    await advisory_xact_lock(session, f"design-session:{session_id}")  # seq 직렬화
    next_seq = (
        await session.scalar(
            select(func.coalesce(func.max(DesignSessionTurn.seq), 0)).where(
                DesignSessionTurn.session_id == session_id
            )
        )
        or 0
    ) + 1
    turn = DesignSessionTurn(
        session_id=session_id, seq=next_seq, role=body.role, payload=body.payload
    )
    session.add(turn)
    await session.commit()
    await session.refresh(turn)
    return DesignTurnOut.model_validate(turn)


@router.post("/design/generate", response_model=DesignGenerateOut)
async def generate_design(
    body: DesignGenerateRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> DesignGenerateOut:
    design_session = None
    if body.session_id is not None:
        design_session = await session.get(DesignSession, body.session_id)
        ensure_owner(design_session, user)
    payload = body.model_dump(exclude={"session_id"}, exclude_none=True)
    response = await request.app.state.worker.generate(payload)
    if design_session is not None:
        assert design_session is not None
        design_session.registry_version = response.get("registry_version")
        if body.intent is not None:
            design_session.current_intent = body.intent
        await _append_turn(
            session,
            design_session.id,
            "assistant",
            {"type": "generate", "response": response},
        )
    await session.commit()
    return DesignGenerateOut.model_validate(response)


@router.post(
    "/design/sessions/{session_id}/finalize",
    response_model=GenerationJobOut,
    status_code=201,
)
async def create_finalize_job(
    session_id: uuid.UUID,
    body: FinalizeRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> GenerationJobOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    intent = body.intent or design_session.current_intent
    if intent is None:
        raise ConflictError("finalize할 intent가 없습니다")
    # 예산 차감은 조건부 UPDATE로 원자화 — 동시 요청이 read-then-write로 초과 차감하는 것 방지
    budget = request.app.state.settings.design_finalize_budget
    claimed = await session.execute(
        update(DesignSession)
        .where(DesignSession.id == session_id, DesignSession.finalize_used < budget)
        .values(finalize_used=DesignSession.finalize_used + 1)
    )
    if cast("CursorResult[Any]", claimed).rowcount == 0:
        raise ConflictError("finalize 예산을 모두 사용했습니다")
    job = GenerationJob(
        user_id=user.id,
        session_id=session_id,
        kind="finalize",
        params={
            "intent": intent,
            "colorway_id": body.colorway_id or design_session.colorway,
            "production_method": body.production_method,
            "dpi": body.dpi,
        },
        request_id=request_id_var.get(),
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    if request.app.state.settings.worker_finalize_inline:
        await request.app.state.worker.finalize_job(str(job.id))
        await session.refresh(job)
    else:
        await request.app.state.tasks.enqueue_finalize(job.id)
    return GenerationJobOut.model_validate(job)


@router.get("/design/jobs/{job_id}", response_model=GenerationJobOut)
async def get_generation_job(
    job_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> GenerationJobOut:
    job = await session.get(GenerationJob, job_id)
    ensure_owner(job, user)
    return GenerationJobOut.model_validate(job)


async def _append_turn(
    session: SessionDep, session_id: uuid.UUID, role: str, payload: dict[str, Any]
) -> None:
    await advisory_xact_lock(session, f"design-session:{session_id}")
    next_seq = (
        await session.scalar(
            select(func.coalesce(func.max(DesignSessionTurn.seq), 0)).where(
                DesignSessionTurn.session_id == session_id
            )
        )
        or 0
    ) + 1
    session.add(DesignSessionTurn(session_id=session_id, seq=next_seq, role=role, payload=payload))
