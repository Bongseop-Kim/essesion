"""관리자용 저작 예시 승격 검토와 active RAG 집합 관리."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from db.models.seamless import (
    AuthoringExample,
    AuthoringPromotionCandidate,
    SeamlessGenerationLog,
)
from fastapi import APIRouter, Query, Request
from obs import request_id_var
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import func, or_, select
from svg_safety import SanitizeError, sanitize_svg

from api.db import SessionDep, advisory_xact_lock
from api.deps import AdminOnly, AdminUser
from api.domains.admin.operations import idempotent_result, record_operation
from api.domains.admin.schemas import Page
from api.errors import ConflictError, NotFoundError

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
ExampleSourceFilter = Literal["all", "bootstrap", "promoted"]
ActiveFilter = Literal["all", "active", "inactive"]
PreviewStatus = Literal["safe", "unavailable", "unsafe"]

PLAN_CONTRACT_VERSION = 3
SEMANTIC_DUPLICATE_THRESHOLD = 0.95
DEFAULT_LIMIT = 20
MAX_LIMIT = 100


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
    source: Literal["bootstrap", "promoted"]
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


class AuthoringExampleActivationRequest(BaseModel):
    operation_id: uuid.UUID
    active: bool
    reason: str = Field(min_length=3, max_length=500)
    expected_updated_at: AwareDatetime


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
    if duplicate is not None:
        example_id, similarity = duplicate
        raise ConflictError(
            f"활성 예시 {example_id}와 중복됩니다 (유사도 {similarity:.3f})",
            code="authoring_example_duplicate",
        )
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
    row = await _example_or_404(session, example_id)
    return AuthoringExampleDetailOut(
        **_example_summary(row).model_dump(),
        source_digest=row.source_digest,
        plan=row.plan,
    )


@router.post(
    "/examples/{example_id}/activation",
    response_model=AuthoringExampleDetailOut,
)
async def set_authoring_example_activation(
    example_id: uuid.UUID,
    body: AuthoringExampleActivationRequest,
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
        row = await _example_or_404(session, example_id)
        return AuthoringExampleDetailOut(
            **_example_summary(row).model_dump(),
            source_digest=row.source_digest,
            plan=row.plan,
        )

    row = await _example_or_404(session, example_id, lock=True)
    if row.updated_at.astimezone(UTC) != body.expected_updated_at.astimezone(UTC):
        raise ConflictError(
            "저작 예시가 다른 관리자에 의해 변경되었습니다",
            code="stale_resource",
        )
    if row.active == body.active:
        raise ConflictError(
            "저작 예시가 이미 요청한 활성 상태입니다",
            code="activation_unchanged",
        )
    if body.active:
        if (
            row.contract_version != PLAN_CONTRACT_VERSION
            or row.embedding_vertex is None
            or row.approved_at is None
        ):
            raise ConflictError(
                "현재 계약과 임베딩이 준비된 승인 예시만 활성화할 수 있습니다",
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
        if duplicate is not None:
            duplicate_id, similarity = duplicate
            raise ConflictError(
                f"활성 예시 {duplicate_id}와 중복됩니다 (유사도 {similarity:.3f})",
                code="authoring_example_duplicate",
            )
    before = {"active": row.active, "updated_at": row.updated_at.isoformat()}
    now = datetime.now(UTC)
    row.active = body.active
    row.active_updated_at = now
    row.active_updated_by = admin.id
    row.active_reason = body.reason.strip()
    after = {"active": row.active}
    record_operation(
        session,
        operation_id=body.operation_id,
        actor_id=admin.id,
        action="authoring_example_activation",
        target_type="authoring_example",
        target_id=str(example_id),
        target_count=1,
        reason=body.reason,
        payload=payload,
        before=before,
        after=after,
        request_id=request_id_var.get(),
    )
    await session.commit()
    row = await _example_or_404(session, example_id)
    return AuthoringExampleDetailOut(
        **_example_summary(row).model_dump(),
        source_digest=row.source_digest,
        plan=row.plan,
    )
