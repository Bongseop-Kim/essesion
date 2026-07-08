"""디자인 세션 골격 — 세션 상태는 api 소유(LangGraph 대체), 워커 연동은 4단계.

예산 카운터(recraft_used/finalize_used)는 Postgres 공유 카운터 — 인스턴스 수와
무관하게 동작 (ARCHITECTURE §7). 턴 payload 스키마는 /design 신규 기획(5단계)에서 구체화.
"""

import uuid
from datetime import datetime
from typing import Any, Literal, cast

from db.models.design import DesignSession, DesignSessionTurn, GenerationJob
from fastapi import APIRouter, Request, Response
from obs import request_id_var
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import CursorResult, func, select, update

from api.db import SessionDep, advisory_xact_lock
from api.deps import CurrentUser, ensure_owner
from api.domains.tokens import ledger
from api.errors import ConflictError, DomainError, UpstreamError, WorkerRequestError

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
    candidate_count: int = Field(1, ge=1, le=8)  # 워커 경계와 동일 — 선검증으로 헛환불 방지


class DesignGenerateOut(BaseModel):
    request_id: str
    registry_version: str
    engine_version: str
    candidates: list[WorkerCandidateOut]
    warnings: list[str] = []


class DesignExportRequest(BaseModel):
    """SVG → PNG/TIFF 형식 변환 — 이미 생성된 디자인의 재출력이라 토큰 과금 없음.

    dpi·치수 상한은 워커가 최종 권위(WorkerRequestError로 detail 전파) — 여기서
    중복 선언하면 KNOWN_WEAVES처럼 드리프트 위험이라 구조 검증만 한다.
    """

    session_id: uuid.UUID | None = None  # 있으면 소유자 확인
    svg: str = Field(max_length=2_000_000)
    format: Literal["png", "tiff"] = "png"
    dpi: int = Field(300, ge=1)
    width_mm: float = Field(gt=0)
    height_mm: float | None = Field(None, gt=0)


# 워커 에셋(assets/fabric/*.png) stem과 일치해야 하는 얕은 사전검증용 상수 —
# 잘못된 weave가 finalize 예산을 태우기 전에 400으로 거른다(worker는 최종 권위).
KNOWN_WEAVES = ("check", "herringbone", "jacquard", "pindot", "solid", "twill-0", "twill-45")


class FinalizeRequest(BaseModel):
    intent: dict[str, Any] | None = None
    colorway_id: str | None = None
    production_method: str | None = None
    dpi: int | None = None
    weave: str | None = None
    material_map: dict[str, str] | None = None
    texture_strength: float | None = Field(None, ge=0)
    relief_strength: float | None = Field(None, ge=0)


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

    # 과금 — work_id는 서버 생성 (X-Request-ID는 클라이언트 제어 값이라 멱등 히트 악용 가능).
    # 선차감 후 워커 실패 시 환불 — 워커 422(잘못된 intent)도 환불되는 관대한 기본값.
    work_id = f"design_generate_{uuid.uuid4().hex}"
    charge = await ledger.use_tokens(session, user.id, work_id)
    if not charge.success:
        raise DomainError("디자인 토큰이 부족합니다", code=charge.error or "insufficient_tokens")
    try:
        response = await request.app.state.worker.generate(payload)
    except (UpstreamError, WorkerRequestError):
        # 둘 다 환불하되 응답은 구분 — 요청 오류는 422(detail 보존), 일시 장애는 502.
        await ledger.refund_failed_generation(session, user.id, charge.cost, f"{work_id}_refund")
        raise
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


@router.post("/design/export")
async def export_design(
    body: DesignExportRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> Response:
    """디자인 SVG를 PNG/TIFF로 변환해 바이너리로 반환 (워커 /export 프록시, 과금 없음)."""
    if body.session_id is not None:
        ensure_owner(await session.get(DesignSession, body.session_id), user)
    data, media = await request.app.state.worker.export(
        body.model_dump(exclude={"session_id"}, exclude_none=True)
    )
    return Response(content=data, media_type=media)


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
    if body.weave is not None and body.weave not in KNOWN_WEAVES:
        raise DomainError(f"알 수 없는 weave입니다: {body.weave}", code="unknown_weave")
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
            # yarn_dyed 텍스처 노브 — None은 제외해 워커 기본값을 살린다.
            **{
                k: v
                for k, v in (
                    ("weave", body.weave),
                    ("material_map", body.material_map),
                    ("texture_strength", body.texture_strength),
                    ("relief_strength", body.relief_strength),
                )
                if v is not None
            },
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


# ---- 모티프 프록시 — worker는 OIDC 프라이빗이라 api가 인증·예산을 얹어 중계 ----


class MotifSpecIn(BaseModel):
    subject: str
    scope: str
    view: str | None = None
    expression: str | None = None
    style: str | None = None
    description: str | None = None


class MotifCandidatesRequest(BaseModel):
    spec: MotifSpecIn
    top_k: int = Field(5, ge=1, le=10)


class MotifCandidateOut(BaseModel):
    motif_id: str
    similarity: float | None
    subject: str | None = None
    scope: str | None = None
    view: str | None = None
    style: str | None = None
    description: str | None = None
    source: str | None = None


class MotifCandidatesOut(BaseModel):
    request_id: str
    registry_version: str
    candidates: list[MotifCandidateOut]


class MotifGenerateRequest(BaseModel):
    spec: MotifSpecIn
    seed: int | None = None


class MotifGenerateOut(BaseModel):
    request_id: str
    motif_id: str
    reused: bool
    similarity: float | None


@router.post(
    "/design/sessions/{session_id}/motifs/candidates",
    response_model=MotifCandidatesOut,
)
async def motif_candidates(
    session_id: uuid.UUID,
    body: MotifCandidatesRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> MotifCandidatesOut:
    """read-only 검색 — 워커가 Recraft를 호출하지 않으므로 예산 없음."""
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    response = await request.app.state.worker.motif_candidates(body.model_dump(exclude_none=True))
    return MotifCandidatesOut.model_validate(response)


@router.post(
    "/design/sessions/{session_id}/motifs/generate",
    response_model=MotifGenerateOut,
)
async def motif_generate(
    session_id: uuid.UUID,
    body: MotifGenerateRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> MotifGenerateOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    # 예산 선차감(조건부 UPDATE — finalize와 동일 패턴) 후 커밋 — Recraft가 수십 초라
    # 행 잠금을 들고 있지 않는다. 워커 실패·래더 재사용(reused)이면 보상 환급.
    budget = request.app.state.settings.design_recraft_budget
    claimed = await session.execute(
        update(DesignSession)
        .where(DesignSession.id == session_id, DesignSession.recraft_used < budget)
        .values(recraft_used=DesignSession.recraft_used + 1)
    )
    if cast("CursorResult[Any]", claimed).rowcount == 0:
        raise ConflictError("모티프 생성 예산을 모두 사용했습니다", code="recraft_budget_exhausted")
    await session.commit()

    try:
        response = await request.app.state.worker.motif_generate(body.model_dump(exclude_none=True))
        out = MotifGenerateOut.model_validate(response)
    except Exception:
        await _release_recraft_budget(session, session_id)
        raise
    if out.reused:
        # 래더 히트 — Recraft 미호출이므로 예산 환급 (멱등 재호출이 예산을 태우지 않게)
        await _release_recraft_budget(session, session_id)
    return out


async def _release_recraft_budget(session: SessionDep, session_id: uuid.UUID) -> None:
    await session.execute(
        update(DesignSession)
        .where(DesignSession.id == session_id)
        .values(recraft_used=func.greatest(DesignSession.recraft_used - 1, 0))
    )
    await session.commit()


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
