"""관리자용 저작 예시 승격 검토와 active RAG 집합 관리."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from db.models.seamless import (
    EMBEDDING_DIM,
    AuthoringExample,
    AuthoringPromotionCandidate,
    SeamlessGenerationLog,
)
from fastapi import APIRouter, Query, Request
from obs import request_id_var
from pydantic import AwareDatetime, BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, or_, select
from svg_safety import SanitizeError, is_suspicious_facet_text, sanitize_svg

from api.db import SessionDep, advisory_xact_lock
from api.deps import AdminOnly, AdminUser
from api.domains.admin.operations import idempotent_result, record_operation
from api.domains.admin.schemas import Page
from api.errors import ConflictError, NotFoundError, UpstreamError

router = APIRouter(prefix="/admin/authoring", tags=["admin-authoring"])

CandidateStatus = Literal[
    "pending",
    "hold",
    "rejected",
    "approved",
    "duplicate",
    "invalid",
]
CandidateStatusFilter = Literal[
    "all",
    "pending",
    "hold",
    "rejected",
    "approved",
    "duplicate",
    "invalid",
]
CandidateDecision = Literal["hold", "reject", "approve"]
ExampleSourceFilter = Literal["all", "bootstrap", "promoted", "authored"]
ActiveFilter = Literal["all", "active", "inactive"]
PreviewStatus = Literal["safe", "unavailable", "unsafe"]

PLAN_CONTRACT_VERSION = 3
SEMANTIC_DUPLICATE_THRESHOLD = 0.95
DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def _normalize_retrieval_text(value: str) -> str:
    normalized = value.strip()
    if len(normalized) < 10:
        raise ValueError("retrieval_text must contain at least 10 non-blank characters")
    return normalized


def _normalize_motif_ids(values: list[str]) -> list[str]:
    normalized = [value.strip() for value in values]
    if any(not value for value in normalized):
        raise ValueError("motif IDs may not be blank")
    if len(normalized) != len(set(normalized)):
        raise ValueError("motif IDs must be distinct")
    return normalized


class AuthoringCandidateSummaryOut(BaseModel):
    id: uuid.UUID
    source_generation_log_id: uuid.UUID | None
    plan_index: int
    selected_candidate_id: str
    contract_version: int
    compiler_revision: str
    prompt_revision: str
    family: str
    motif_count: int
    retrieval_text: str
    tags: list[str]
    # 승인 후보 텍스트가 인젝션 휴리스틱에 걸리면 관리자에게 플래그 (C-10, 최종 승인은 사람).
    injection_suspected: bool
    structural_fingerprint: str | None
    nearest_kind: str | None
    nearest_id: str | None
    nearest_similarity: float | None
    status: CandidateStatus
    rule_reasons: list[Any]
    review_version: int
    reviewed_at: datetime | None
    reviewed_by: uuid.UUID | None
    review_reason: str | None
    approved_example_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class AuthoringCandidateDetailOut(AuthoringCandidateSummaryOut):
    source_key: str
    source_digest: str
    embedding_model: str | None
    plan: dict[str, Any]
    preview_svg: str | None
    preview_status: PreviewStatus


class AuthoringCandidateDecisionRequest(BaseModel):
    operation_id: uuid.UUID
    decision: CandidateDecision
    reason: str = Field(min_length=3, max_length=500)
    expected_review_version: int = Field(ge=0)


class AuthoringExampleSummaryOut(BaseModel):
    id: uuid.UUID
    example_id: str
    source: Literal["bootstrap", "promoted", "authored"]
    contract_version: int
    family: str
    motif_count: int
    retrieval_text: str
    tags: list[str]
    structural_fingerprint: str
    embedding_model: str
    active: bool
    approved_at: datetime | None
    approved_by: uuid.UUID | None
    active_updated_at: datetime | None
    active_updated_by: uuid.UUID | None
    active_reason: str | None
    created_at: datetime
    updated_at: datetime


class AuthoringExampleDetailOut(AuthoringExampleSummaryOut):
    source_digest: str
    plan: dict[str, Any]
    motif_ids: list[str]


class AuthoringExampleActivationRequest(BaseModel):
    operation_id: uuid.UUID
    active: bool
    expected_updated_at: AwareDatetime


class AuthoringExamplePreviewRequest(BaseModel):
    plan: dict[str, Any]
    motif_ids: list[str] = Field(default_factory=list, max_length=2)
    colorway: str | None = Field(default=None, min_length=1, max_length=100)
    seed: int | None = Field(default=None, ge=-(2**63), le=2**63 - 1)
    tile_mm: float = Field(default=48.0, gt=0.0, le=500.0, allow_inf_nan=False)

    @field_validator("motif_ids")
    @classmethod
    def _distinct_motif_ids(cls, values: list[str]) -> list[str]:
        return _normalize_motif_ids(values)


class AuthoringExamplePreviewOut(BaseModel):
    svg: str
    warnings: list[str]


class _AuthoringExampleWriteFields(BaseModel):
    retrieval_text: str = Field(min_length=10, max_length=500)
    plan: dict[str, Any]
    motif_ids: list[str] = Field(default_factory=list, max_length=2)

    @field_validator("retrieval_text")
    @classmethod
    def _normalize_retrieval_text(cls, value: str) -> str:
        return _normalize_retrieval_text(value)

    @field_validator("motif_ids")
    @classmethod
    def _normalize_motif_ids(cls, values: list[str]) -> list[str]:
        return _normalize_motif_ids(values)


class AuthoringExampleCreateRequest(_AuthoringExampleWriteFields):
    pass


class AuthoringExampleUpdateRequest(BaseModel):
    operation_id: uuid.UUID
    expected_updated_at: AwareDatetime
    retrieval_text: str | None = Field(default=None, min_length=10, max_length=500)
    plan: dict[str, Any] | None = None
    motif_ids: list[str] | None = Field(default=None, max_length=2)

    @field_validator("retrieval_text")
    @classmethod
    def _normalize_retrieval_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_retrieval_text(value)

    @field_validator("motif_ids")
    @classmethod
    def _normalize_motif_ids(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        return _normalize_motif_ids(values)

    @model_validator(mode="after")
    def _has_persisted_change(self) -> AuthoringExampleUpdateRequest:
        if self.retrieval_text is None and self.plan is None and self.motif_ids is None:
            raise ValueError("retrieval_text, plan, or motif_ids is required")
        return self


class AuthoringExampleDeleteRequest(BaseModel):
    operation_id: uuid.UUID


class _WorkerPreparedAuthoringExample(BaseModel):
    contract_version: int
    family: str
    motif_count: int
    retrieval_text: str
    tags: list[str]
    plan: dict[str, Any]
    structural_fingerprint: str
    source_digest: str
    embedding_model: str
    embedding: list[float] = Field(min_length=EMBEDDING_DIM, max_length=EMBEDDING_DIM)


class _WorkerAuthoringEmbeddingModel(BaseModel):
    model: str


def _candidate_summary(row: AuthoringPromotionCandidate) -> AuthoringCandidateSummaryOut:
    return AuthoringCandidateSummaryOut(
        id=row.id,
        source_generation_log_id=row.source_generation_log_id,
        plan_index=row.plan_index,
        selected_candidate_id=row.selected_candidate_id,
        contract_version=row.contract_version,
        compiler_revision=row.compiler_revision,
        prompt_revision=row.prompt_revision,
        family=row.family,
        motif_count=row.motif_count,
        retrieval_text=row.retrieval_text,
        tags=row.tags,
        injection_suspected=is_suspicious_facet_text(row.retrieval_text or ""),
        structural_fingerprint=row.structural_fingerprint,
        nearest_kind=row.nearest_kind,
        nearest_id=row.nearest_id,
        nearest_similarity=row.nearest_similarity,
        status=row.status,  # type: ignore[arg-type]
        rule_reasons=row.rule_reasons,
        review_version=row.review_version,
        reviewed_at=row.reviewed_at,
        reviewed_by=row.reviewed_by,
        review_reason=row.review_reason,
        approved_example_id=row.approved_example_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _example_summary(row: AuthoringExample) -> AuthoringExampleSummaryOut:
    return AuthoringExampleSummaryOut(
        id=row.id,
        example_id=row.example_id,
        source=row.source,  # type: ignore[arg-type]
        contract_version=row.contract_version,
        family=row.family,
        motif_count=row.motif_count,
        retrieval_text=row.retrieval_text,
        tags=row.tags,
        structural_fingerprint=row.structural_fingerprint,
        embedding_model=row.embedding_model,
        active=row.active,
        approved_at=row.approved_at,
        approved_by=row.approved_by,
        active_updated_at=row.active_updated_at,
        active_updated_by=row.active_updated_by,
        active_reason=row.active_reason,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _example_detail(row: AuthoringExample) -> AuthoringExampleDetailOut:
    return AuthoringExampleDetailOut(
        **_example_summary(row).model_dump(),
        source_digest=row.source_digest,
        plan=row.plan,
        motif_ids=row.motif_ids,
    )


def _example_audit_state(row: AuthoringExample) -> dict[str, Any]:
    return {
        "active": row.active,
        "contract_version": row.contract_version,
        "family": row.family,
        "motif_count": row.motif_count,
        "retrieval_text": row.retrieval_text,
        "tags": list(row.tags),
        "plan": row.plan,
        "motif_ids": list(row.motif_ids),
        "structural_fingerprint": row.structural_fingerprint,
        "source_digest": row.source_digest,
        "embedding_model": row.embedding_model,
        "embedding_vertex": (
            [float(value) for value in row.embedding_vertex]
            if row.embedding_vertex is not None
            else None
        ),
    }


async def _prepare_authored_example(
    request: Request,
    *,
    retrieval_text: str,
    plan: dict[str, Any],
    motif_ids: list[str] | None = None,
) -> _WorkerPreparedAuthoringExample:
    if motif_ids:
        await request.app.state.worker.preview_authoring_example(
            {
                "plan": plan,
                "motif_ids": motif_ids,
                "tile_mm": 48.0,
            }
        )
    prepared = _WorkerPreparedAuthoringExample.model_validate(
        await request.app.state.worker.prepare_authoring_example(
            {
                "retrieval_text": retrieval_text,
                "plan": plan,
            }
        )
    )
    if prepared.contract_version != PLAN_CONTRACT_VERSION:
        raise ConflictError(
            "저작 예시의 Plan 계약이 현재 버전과 맞지 않습니다",
            code="authoring_contract_mismatch",
        )
    return prepared


async def _candidate_or_404(
    session,
    candidate_id: uuid.UUID,
    *,
    lock: bool = False,
) -> AuthoringPromotionCandidate:
    query = select(AuthoringPromotionCandidate).where(
        AuthoringPromotionCandidate.id == candidate_id
    )
    if lock:
        query = query.with_for_update()
    row = await session.scalar(query.execution_options(populate_existing=True))
    if row is None:
        raise NotFoundError("승격 후보를 찾을 수 없습니다")
    return row


async def _example_or_404(
    session,
    example_id: uuid.UUID,
    *,
    lock: bool = False,
) -> AuthoringExample:
    query = select(AuthoringExample).where(AuthoringExample.id == example_id)
    if lock:
        query = query.with_for_update()
    row = await session.scalar(query.execution_options(populate_existing=True))
    if row is None:
        raise NotFoundError("저작 예시를 찾을 수 없습니다")
    return row


async def _candidate_preview(
    session,
    row: AuthoringPromotionCandidate,
) -> tuple[str | None, PreviewStatus]:
    if row.source_generation_log_id is None:
        return None, "unavailable"
    log = await session.get(SeamlessGenerationLog, row.source_generation_log_id)
    if log is None:
        return None, "unavailable"
    for candidate in log.candidates or []:
        if not isinstance(candidate, dict) or candidate.get("id") != row.selected_candidate_id:
            continue
        raw_svg = candidate.get("svg")
        if not isinstance(raw_svg, str):
            return None, "unavailable"
        try:
            return sanitize_svg(raw_svg), "safe"
        except SanitizeError:
            return None, "unsafe"
    return None, "unavailable"


async def _candidate_detail(
    session,
    row: AuthoringPromotionCandidate,
) -> AuthoringCandidateDetailOut:
    preview_svg, preview_status = await _candidate_preview(session, row)
    return AuthoringCandidateDetailOut(
        **_candidate_summary(row).model_dump(),
        source_key=row.source_key,
        source_digest=row.source_digest,
        embedding_model=row.embedding_model,
        plan=row.plan,
        preview_svg=preview_svg,
        preview_status=preview_status,
    )


@router.get("/candidates", response_model=Page[AuthoringCandidateSummaryOut])
async def list_authoring_candidates(
    session: SessionDep,
    admin: AdminUser,
    status: CandidateStatusFilter = "pending",
    family: str | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AuthoringCandidateSummaryOut]:
    query = select(AuthoringPromotionCandidate)
    if status != "all":
        query = query.where(AuthoringPromotionCandidate.status == status)
    if family:
        query = query.where(AuthoringPromotionCandidate.family == family)
    if q and (term := q.strip()):
        pattern = f"%{term}%"
        query = query.where(
            or_(
                AuthoringPromotionCandidate.retrieval_text.ilike(pattern),
                AuthoringPromotionCandidate.source_key.ilike(pattern),
                AuthoringPromotionCandidate.structural_fingerprint.ilike(pattern),
            )
        )
    total = int(await session.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = await session.scalars(
        query.order_by(
            AuthoringPromotionCandidate.created_at.desc(),
            AuthoringPromotionCandidate.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    return Page(
        items=[_candidate_summary(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/candidates/{candidate_id}",
    response_model=AuthoringCandidateDetailOut,
)
async def get_authoring_candidate(
    candidate_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
) -> AuthoringCandidateDetailOut:
    return await _candidate_detail(session, await _candidate_or_404(session, candidate_id))


def _validate_review_transition(
    row: AuthoringPromotionCandidate,
    decision: CandidateDecision,
) -> None:
    allowed = {
        "pending": {"hold", "reject", "approve"},
        "hold": {"reject", "approve"},
    }
    if decision not in allowed.get(row.status, set()):
        raise ConflictError(
            "현재 상태에서는 해당 검토 결정을 적용할 수 없습니다",
            code="invalid_candidate_transition",
        )


async def _approval_duplicate(
    session,
    *,
    structural_fingerprint: str,
    embedding_vertex: Any,
    embedding_model: str,
    family: str,
    motif_count: int,
    exclude_example_id: uuid.UUID | None = None,
) -> tuple[str, float] | None:
    exact = select(AuthoringExample).where(
        AuthoringExample.active.is_(True),
        AuthoringExample.structural_fingerprint == structural_fingerprint,
    )
    if exclude_example_id is not None:
        exact = exact.where(AuthoringExample.id != exclude_example_id)
    exact_row = await session.scalar(exact.limit(1))
    if exact_row is not None:
        return exact_row.example_id, 1.0

    distance = AuthoringExample.embedding_vertex.cosine_distance(embedding_vertex)
    semantic = select(AuthoringExample.example_id, distance).where(
        AuthoringExample.active.is_(True),
        AuthoringExample.contract_version == PLAN_CONTRACT_VERSION,
        AuthoringExample.embedding_model == embedding_model,
        AuthoringExample.family == family,
        AuthoringExample.motif_count == motif_count,
        AuthoringExample.embedding_vertex.is_not(None),
    )
    if exclude_example_id is not None:
        semantic = semantic.where(AuthoringExample.id != exclude_example_id)
    nearest = (await session.execute(semantic.order_by(distance).limit(1))).first()
    if nearest is None:
        return None
    similarity = 1.0 - float(nearest[1])
    if similarity >= SEMANTIC_DUPLICATE_THRESHOLD:
        return str(nearest[0]), similarity
    return None


def _raise_example_duplicate(duplicate: tuple[str, float] | None) -> None:
    if duplicate is None:
        return
    example_id, similarity = duplicate
    raise ConflictError(
        f"활성 시범 {example_id}와 중복됩니다 (유사도 {similarity:.3f})",
        code="authoring_example_duplicate",
    )


async def _approve_candidate(
    session,
    candidate: AuthoringPromotionCandidate,
    *,
    admin_id: uuid.UUID,
    reason: str,
) -> AuthoringExample:
    if (
        candidate.contract_version != PLAN_CONTRACT_VERSION
        or candidate.structural_fingerprint is None
        or candidate.embedding_model is None
        or candidate.embedding_vertex is None
    ):
        raise ConflictError(
            "승격 후보의 계약 또는 임베딩이 현재 기준과 맞지 않습니다",
            code="candidate_not_ready",
        )
    await advisory_xact_lock(session, "authoring-active-examples")
    duplicate = await _approval_duplicate(
        session,
        structural_fingerprint=candidate.structural_fingerprint,
        embedding_vertex=candidate.embedding_vertex,
        embedding_model=candidate.embedding_model,
        family=candidate.family,
        motif_count=candidate.motif_count,
    )
    _raise_example_duplicate(duplicate)
    now = datetime.now(UTC)
    example = AuthoringExample(
        example_id=f"promoted_{candidate.id.hex}",
        source="promoted",
        contract_version=candidate.contract_version,
        family=candidate.family,
        motif_count=candidate.motif_count,
        retrieval_text=candidate.retrieval_text,
        tags=candidate.tags,
        plan=candidate.plan,
        structural_fingerprint=candidate.structural_fingerprint,
        source_digest=candidate.source_digest,
        embedding_model=candidate.embedding_model,
        embedding_vertex=candidate.embedding_vertex,
        active=True,
        approved_at=now,
        approved_by=admin_id,
        active_updated_at=now,
        active_updated_by=admin_id,
        active_reason=reason,
    )
    session.add(example)
    await session.flush()
    return example


@router.post(
    "/candidates/{candidate_id}/decision",
    response_model=AuthoringCandidateDetailOut,
)
async def decide_authoring_candidate(
    candidate_id: uuid.UUID,
    body: AuthoringCandidateDecisionRequest,
    request: Request,
    session: SessionDep,
    admin: AdminOnly,
) -> AuthoringCandidateDetailOut:
    payload = body.model_dump(mode="json", exclude={"operation_id"})
    previous = await idempotent_result(
        session,
        operation_id=body.operation_id,
        action="authoring_candidate_decision",
        target_type="authoring_promotion_candidate",
        target_id=str(candidate_id),
        payload=payload,
    )
    if previous is not None:
        return await _candidate_detail(
            session,
            await _candidate_or_404(session, candidate_id),
        )

    candidate = await _candidate_or_404(session, candidate_id)
    if candidate.review_version != body.expected_review_version:
        raise ConflictError(
            "승격 후보가 다른 관리자에 의해 변경되었습니다",
            code="stale_resource",
        )
    _validate_review_transition(candidate, body.decision)
    if body.decision == "approve":
        await request.app.state.worker.ensure_authoring_promotion_embedding(str(candidate_id))

    candidate = await _candidate_or_404(session, candidate_id, lock=True)
    if candidate.review_version != body.expected_review_version:
        raise ConflictError(
            "승격 후보가 다른 관리자에 의해 변경되었습니다",
            code="stale_resource",
        )
    _validate_review_transition(candidate, body.decision)
    before = {
        "status": candidate.status,
        "review_version": candidate.review_version,
        "approved_example_id": (
            str(candidate.approved_example_id) if candidate.approved_example_id else None
        ),
    }
    approved_example: AuthoringExample | None = None
    if body.decision == "approve":
        approved_example = await _approve_candidate(
            session,
            candidate,
            admin_id=admin.id,
            reason=body.reason.strip(),
        )
        candidate.status = "approved"
        candidate.approved_example_id = approved_example.id
    elif body.decision == "reject":
        candidate.status = "rejected"
    else:
        candidate.status = "hold"
    candidate.review_version += 1
    candidate.reviewed_at = datetime.now(UTC)
    candidate.reviewed_by = admin.id
    candidate.review_reason = body.reason.strip()
    after = {
        "status": candidate.status,
        "review_version": candidate.review_version,
        "approved_example_id": (str(approved_example.id) if approved_example is not None else None),
    }
    record_operation(
        session,
        operation_id=body.operation_id,
        actor_id=admin.id,
        action="authoring_candidate_decision",
        target_type="authoring_promotion_candidate",
        target_id=str(candidate_id),
        target_count=1,
        reason=body.reason,
        payload=payload,
        before=before,
        after=after,
        request_id=request_id_var.get(),
    )
    await session.commit()
    return await _candidate_detail(
        session,
        await _candidate_or_404(session, candidate_id),
    )


async def _compiled_preview(
    request: Request, payload: dict[str, Any]
) -> AuthoringExamplePreviewOut:
    result = AuthoringExamplePreviewOut.model_validate(
        await request.app.state.worker.preview_authoring_example(payload)
    )
    try:
        safe_svg = sanitize_svg(result.svg)
    except SanitizeError as exc:
        raise UpstreamError("저작 프리뷰 SVG 안전성 검증에 실패했습니다") from exc
    return result.model_copy(update={"svg": safe_svg})


@router.post("/preview", response_model=AuthoringExamplePreviewOut)
async def preview_authoring_example(
    body: AuthoringExamplePreviewRequest,
    request: Request,
    admin: AdminOnly,
) -> AuthoringExamplePreviewOut:
    return await _compiled_preview(request, body.model_dump(mode="json", exclude_none=True))


@router.post(
    "/examples",
    response_model=AuthoringExampleDetailOut,
    status_code=201,
)
async def create_authoring_example(
    body: AuthoringExampleCreateRequest,
    request: Request,
    session: SessionDep,
    admin: AdminOnly,
) -> AuthoringExampleDetailOut:
    prepared = await _prepare_authored_example(
        request,
        retrieval_text=body.retrieval_text,
        plan=body.plan,
        motif_ids=body.motif_ids,
    )
    await advisory_xact_lock(session, "authoring-active-examples")
    _raise_example_duplicate(
        await _approval_duplicate(
            session,
            structural_fingerprint=prepared.structural_fingerprint,
            embedding_vertex=prepared.embedding,
            embedding_model=prepared.embedding_model,
            family=prepared.family,
            motif_count=prepared.motif_count,
        )
    )
    now = datetime.now(UTC)
    row_id = uuid.uuid4()
    row = AuthoringExample(
        id=row_id,
        example_id=f"authored_{row_id.hex}",
        source="authored",
        contract_version=prepared.contract_version,
        family=prepared.family,
        motif_count=prepared.motif_count,
        retrieval_text=prepared.retrieval_text,
        tags=prepared.tags,
        plan=prepared.plan,
        motif_ids=body.motif_ids,
        structural_fingerprint=prepared.structural_fingerprint,
        source_digest=prepared.source_digest,
        embedding_model=prepared.embedding_model,
        embedding_vertex=prepared.embedding,
        active=False,
        approved_at=now,
        approved_by=admin.id,
    )
    session.add(row)
    await session.commit()
    return _example_detail(await _example_or_404(session, row_id))


@router.get("/examples", response_model=Page[AuthoringExampleSummaryOut])
async def list_authoring_examples(
    session: SessionDep,
    admin: AdminUser,
    active: ActiveFilter = "all",
    source: ExampleSourceFilter = "all",
    family: str | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AuthoringExampleSummaryOut]:
    query = select(AuthoringExample)
    if active != "all":
        query = query.where(AuthoringExample.active.is_(active == "active"))
    if source != "all":
        query = query.where(AuthoringExample.source == source)
    if family:
        query = query.where(AuthoringExample.family == family)
    if q and (term := q.strip()):
        pattern = f"%{term}%"
        query = query.where(
            or_(
                AuthoringExample.example_id.ilike(pattern),
                AuthoringExample.retrieval_text.ilike(pattern),
                AuthoringExample.structural_fingerprint.ilike(pattern),
            )
        )
    total = int(await session.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = await session.scalars(
        query.order_by(AuthoringExample.created_at.desc(), AuthoringExample.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return Page(
        items=[_example_summary(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/examples/{example_id}", response_model=AuthoringExampleDetailOut)
async def get_authoring_example(
    example_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
) -> AuthoringExampleDetailOut:
    return _example_detail(await _example_or_404(session, example_id))


@router.get(
    "/examples/{example_id}/preview",
    response_model=AuthoringExamplePreviewOut,
)
async def get_authoring_example_preview(
    example_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    admin: AdminUser,
) -> AuthoringExamplePreviewOut:
    """저장된 plan·모티프로 타일 프리뷰를 렌더한다 — 목록 썸네일용."""
    row = await _example_or_404(session, example_id)
    return await _compiled_preview(
        request,
        {"plan": row.plan, "motif_ids": row.motif_ids, "tile_mm": 48.0},
    )


@router.patch("/examples/{example_id}", response_model=AuthoringExampleDetailOut)
async def update_authoring_example(
    example_id: uuid.UUID,
    body: AuthoringExampleUpdateRequest,
    request: Request,
    session: SessionDep,
    admin: AdminOnly,
) -> AuthoringExampleDetailOut:
    payload = body.model_dump(mode="json", exclude={"operation_id"})
    previous = await idempotent_result(
        session,
        operation_id=body.operation_id,
        action="authoring_example_update",
        target_type="authoring_example",
        target_id=str(example_id),
        payload=payload,
    )
    if previous is not None:
        return _example_detail(await _example_or_404(session, example_id))

    current = await _example_or_404(session, example_id)
    if current.updated_at.astimezone(UTC) != body.expected_updated_at.astimezone(UTC):
        raise ConflictError(
            "저작 시범이 다른 관리자에 의해 변경되었습니다",
            code="stale_resource",
        )
    prepared = await _prepare_authored_example(
        request,
        retrieval_text=(
            body.retrieval_text if body.retrieval_text is not None else current.retrieval_text
        ),
        plan=body.plan if body.plan is not None else current.plan,
        motif_ids=body.motif_ids if body.motif_ids is not None else current.motif_ids,
    )
    row = await _example_or_404(session, example_id, lock=True)
    if row.updated_at.astimezone(UTC) != body.expected_updated_at.astimezone(UTC):
        raise ConflictError(
            "저작 시범이 다른 관리자에 의해 변경되었습니다",
            code="stale_resource",
        )
    await advisory_xact_lock(session, "authoring-active-examples")
    _raise_example_duplicate(
        await _approval_duplicate(
            session,
            structural_fingerprint=prepared.structural_fingerprint,
            embedding_vertex=prepared.embedding,
            embedding_model=prepared.embedding_model,
            family=prepared.family,
            motif_count=prepared.motif_count,
            exclude_example_id=row.id,
        )
    )
    before = _example_audit_state(row)
    row.contract_version = prepared.contract_version
    row.family = prepared.family
    row.motif_count = prepared.motif_count
    row.retrieval_text = prepared.retrieval_text
    row.tags = prepared.tags
    row.plan = prepared.plan
    if body.motif_ids is not None:
        row.motif_ids = body.motif_ids
    row.structural_fingerprint = prepared.structural_fingerprint
    row.source_digest = prepared.source_digest
    row.embedding_model = prepared.embedding_model
    row.embedding_vertex = prepared.embedding
    row.approved_at = datetime.now(UTC)
    row.approved_by = admin.id
    record_operation(
        session,
        operation_id=body.operation_id,
        actor_id=admin.id,
        action="authoring_example_update",
        target_type="authoring_example",
        target_id=str(example_id),
        target_count=1,
        reason="",
        payload=payload,
        before=before,
        after=_example_audit_state(row),
        request_id=request_id_var.get(),
    )
    await session.commit()
    return _example_detail(await _example_or_404(session, example_id))


@router.delete("/examples/{example_id}", status_code=204)
async def delete_authoring_example(
    example_id: uuid.UUID,
    body: AuthoringExampleDeleteRequest,
    request: Request,
    session: SessionDep,
    admin: AdminOnly,
) -> None:
    payload = body.model_dump(mode="json", exclude={"operation_id"})
    previous = await idempotent_result(
        session,
        operation_id=body.operation_id,
        action="authoring_example_delete",
        target_type="authoring_example",
        target_id=str(example_id),
        payload=payload,
    )
    if previous is not None:
        return

    row = await _example_or_404(session, example_id, lock=True)
    if row.active:
        raise ConflictError(
            "활성 시범은 비활성화한 뒤 삭제해 주세요.",
            code="authoring_example_active",
        )
    before = _example_audit_state(row)
    await session.delete(row)
    record_operation(
        session,
        operation_id=body.operation_id,
        actor_id=admin.id,
        action="authoring_example_delete",
        target_type="authoring_example",
        target_id=str(example_id),
        target_count=1,
        reason="",
        payload=payload,
        before=before,
        after={"deleted": True},
        request_id=request_id_var.get(),
    )
    await session.commit()


@router.post(
    "/examples/{example_id}/activation",
    response_model=AuthoringExampleDetailOut,
)
async def set_authoring_example_activation(
    example_id: uuid.UUID,
    body: AuthoringExampleActivationRequest,
    request: Request,
    session: SessionDep,
    admin: AdminOnly,
) -> AuthoringExampleDetailOut:
    payload = body.model_dump(mode="json", exclude={"operation_id"})
    previous = await idempotent_result(
        session,
        operation_id=body.operation_id,
        action="authoring_example_activation",
        target_type="authoring_example",
        target_id=str(example_id),
        payload=payload,
    )
    if previous is not None:
        return _example_detail(await _example_or_404(session, example_id))

    current = await _example_or_404(session, example_id)
    if current.updated_at.astimezone(UTC) != body.expected_updated_at.astimezone(UTC):
        raise ConflictError(
            "저작 시범이 다른 관리자에 의해 변경되었습니다",
            code="stale_resource",
        )
    if current.active == body.active:
        raise ConflictError(
            "저작 시범이 이미 요청한 활성 상태입니다",
            code="activation_unchanged",
        )
    current_embedding_model: str | None = None
    if body.active:
        current_embedding_model = _WorkerAuthoringEmbeddingModel.model_validate(
            await request.app.state.worker.current_authoring_embedding_model()
        ).model

    row = await _example_or_404(session, example_id, lock=True)
    if row.updated_at.astimezone(UTC) != body.expected_updated_at.astimezone(UTC):
        raise ConflictError(
            "저작 시범이 다른 관리자에 의해 변경되었습니다",
            code="stale_resource",
        )
    if row.active == body.active:
        raise ConflictError(
            "저작 시범이 이미 요청한 활성 상태입니다",
            code="activation_unchanged",
        )
    if body.active:
        if (
            row.contract_version != PLAN_CONTRACT_VERSION
            or row.embedding_vertex is None
            or row.embedding_model != current_embedding_model
            or row.approved_at is None
        ):
            raise ConflictError(
                "현재 계약과 임베딩 모델이 준비된 검증 시범만 활성화할 수 있습니다",
                code="example_not_ready",
            )
        await advisory_xact_lock(session, "authoring-active-examples")
        duplicate = await _approval_duplicate(
            session,
            structural_fingerprint=row.structural_fingerprint,
            embedding_vertex=row.embedding_vertex,
            embedding_model=row.embedding_model,
            family=row.family,
            motif_count=row.motif_count,
            exclude_example_id=row.id,
        )
        _raise_example_duplicate(duplicate)
    before = {"active": row.active, "updated_at": row.updated_at.isoformat()}
    now = datetime.now(UTC)
    row.active = body.active
    row.active_updated_at = now
    row.active_updated_by = admin.id
    row.active_reason = None
    after = {"active": row.active}
    record_operation(
        session,
        operation_id=body.operation_id,
        actor_id=admin.id,
        action="authoring_example_activation",
        target_type="authoring_example",
        target_id=str(example_id),
        target_count=1,
        reason="",
        payload=payload,
        before=before,
        after=after,
        request_id=request_id_var.get(),
    )
    await session.commit()
    return _example_detail(await _example_or_404(session, example_id))
