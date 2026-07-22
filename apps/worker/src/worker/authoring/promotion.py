"""Select finalized Plan v3 generations for administrator promotion review."""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any, cast

from db.models.design import DesignSessionTurn, GenerationJob
from db.models.seamless import (
    AuthoringExample,
    AuthoringPromotionCandidate,
    SeamlessGenerationLog,
)
from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from worker.adapters import AdapterNotConfigured
from worker.adapters.embedding import SupportsEmbed
from worker.authoring.compiler import COMPILER_REVISION, PLAN_CONTRACT_VERSION
from worker.authoring.examples import (
    AuthoringFamily,
    classify_plan_family,
    embedding_document,
    example_source_digest,
    tags_for_plan,
)
from worker.authoring.schema import DesignPlanV3, structural_fingerprint

SEMANTIC_DUPLICATE_THRESHOLD = 0.95
DEFAULT_SCAN_LIMIT = 100
MAX_SCAN_LIMIT = 100
EMBEDDING_CONCURRENCY = 4


@dataclass(frozen=True)
class PromotionScanResult:
    scanned: int = 0
    pending: int = 0
    duplicate: int = 0
    invalid: int = 0
    failed: int = 0


@dataclass(frozen=True)
class _SourcePlan:
    log: SeamlessGenerationLog
    plan_index: int
    selected_candidate_id: str
    raw_plan: dict[str, Any]
    contract_version: int
    compiler_revision: str
    prompt_revision: str

    @property
    def source_key(self) -> str:
        return f"{self.log.id}:{self.plan_index}"


@dataclass(frozen=True)
class _PreparedCandidate:
    source: _SourcePlan
    plan: DesignPlanV3
    family: AuthoringFamily
    tags: list[str]
    fingerprint: str
    digest: str

    @property
    def document(self) -> str:
        assert self.source.log.prompt is not None
        return embedding_document(self.source.log.prompt, self.family, self.tags)


@dataclass(frozen=True)
class _Duplicate:
    kind: str
    identifier: str
    similarity: float
    reason: str


def _safe_authoring(value: object) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    authoring = value.get("authoring")
    return authoring if isinstance(authoring, dict) else None


def _candidate_design_index(log: SeamlessGenerationLog, candidate_id: str) -> int | None:
    for value in log.candidates or []:
        if not isinstance(value, dict) or value.get("id") != candidate_id:
            continue
        index = value.get("design_index")
        return index if isinstance(index, int) and not isinstance(index, bool) else None
    return None


async def _selected_finalized_candidate(
    session: AsyncSession,
    log: SeamlessGenerationLog,
) -> str | None:
    exact_link = DesignSessionTurn.payload["response"]["generation_log_id"].astext == str(log.id)
    generated_turn = await session.scalar(
        select(DesignSessionTurn)
        .where(
            DesignSessionTurn.role == "assistant",
            DesignSessionTurn.payload["type"].astext == "generate",
            exact_link,
        )
        .order_by(DesignSessionTurn.created_at, DesignSessionTurn.seq)
        .limit(1)
    )
    if generated_turn is None:
        return None

    next_request = await session.scalar(
        select(DesignSessionTurn)
        .where(
            DesignSessionTurn.session_id == generated_turn.session_id,
            DesignSessionTurn.seq > generated_turn.seq,
            DesignSessionTurn.payload["type"].astext == "generate_request",
        )
        .order_by(DesignSessionTurn.seq)
        .limit(1)
    )
    candidate_ids = [
        value["id"]
        for value in (log.candidates or [])
        if isinstance(value, dict) and isinstance(value.get("id"), str)
    ]
    if not candidate_ids:
        return None
    selection_filters = [
        DesignSessionTurn.session_id == generated_turn.session_id,
        DesignSessionTurn.seq > generated_turn.seq,
        DesignSessionTurn.payload["type"].astext == "select",
        DesignSessionTurn.payload["candidate_id"].astext.in_(candidate_ids),
    ]
    if next_request is not None:
        selection_filters.append(DesignSessionTurn.seq < next_request.seq)
    selected_turn = await session.scalar(
        select(DesignSessionTurn)
        .where(*selection_filters)
        .order_by(DesignSessionTurn.seq.desc())
        .limit(1)
    )
    if selected_turn is None:
        return None
    selected = selected_turn.payload.get("candidate_id")
    if not isinstance(selected, str):
        return None

    finalize_filters = [
        GenerationJob.session_id == generated_turn.session_id,
        GenerationJob.kind == "finalize",
        GenerationJob.status == "succeeded",
        GenerationJob.params["candidate_id"].astext == selected,
        GenerationJob.created_at >= selected_turn.created_at,
    ]
    if next_request is not None:
        finalize_filters.append(GenerationJob.created_at < next_request.created_at)
    finalized = await session.scalar(
        select(func.count()).select_from(GenerationJob).where(*finalize_filters)
    )
    return selected if finalized else None


async def _source_plans(
    session: AsyncSession,
    *,
    limit: int,
) -> list[_SourcePlan]:
    logs = await session.scalars(
        select(SeamlessGenerationLog)
        .where(
            SeamlessGenerationLog.status == "success",
            SeamlessGenerationLog.prompt.is_not(None),
            SeamlessGenerationLog.intent.is_not(None),
            ~exists().where(
                AuthoringPromotionCandidate.source_generation_log_id == SeamlessGenerationLog.id
            ),
        )
        .order_by(SeamlessGenerationLog.created_at.desc(), SeamlessGenerationLog.id.desc())
        .limit(limit * 5)
    )
    sources: list[_SourcePlan] = []
    for log in logs:
        selected = await _selected_finalized_candidate(session, log)
        if selected is None:
            continue
        plan_index = _candidate_design_index(log, selected)
        authoring = _safe_authoring(log.intent)
        if authoring is None:
            continue
        plans = authoring.get("plans")
        if (
            plan_index is None
            or not isinstance(plans, list)
            or plan_index >= len(plans)
            or not isinstance(plans[plan_index], dict)
        ):
            continue
        contract = authoring.get("plan_contract_version")
        compiler = authoring.get("compiler_revision")
        prompt_revision = authoring.get("prompt_revision")
        sources.append(
            _SourcePlan(
                log=log,
                plan_index=plan_index,
                selected_candidate_id=selected,
                raw_plan=plans[plan_index],
                contract_version=contract if isinstance(contract, int) else 0,
                compiler_revision=compiler if isinstance(compiler, str) else "unknown",
                prompt_revision=(
                    prompt_revision if isinstance(prompt_revision, str) else "unknown"
                ),
            )
        )
        if len(sources) == limit:
            break
    return sources


def _prepare(source: _SourcePlan) -> _PreparedCandidate:
    if source.contract_version != PLAN_CONTRACT_VERSION:
        raise ValueError("contract_version")
    if source.compiler_revision != COMPILER_REVISION:
        raise ValueError("compiler_revision")
    plan = DesignPlanV3.model_validate(source.raw_plan)
    family = classify_plan_family(plan)
    tags = tags_for_plan(plan, family)
    assert source.log.prompt is not None
    return _PreparedCandidate(
        source=source,
        plan=plan,
        family=family,
        tags=tags,
        fingerprint=structural_fingerprint(plan),
        digest=example_source_digest(
            retrieval_text=source.log.prompt,
            family=family,
            tags=tags,
            plan=plan,
        ),
    )


async def _exact_duplicate(
    session: AsyncSession,
    fingerprint: str,
) -> _Duplicate | None:
    example_id = await session.scalar(
        select(AuthoringExample.example_id).where(
            AuthoringExample.active.is_(True),
            AuthoringExample.structural_fingerprint == fingerprint,
        )
    )
    if example_id is not None:
        return _Duplicate("example", example_id, 1.0, "structural_fingerprint")
    candidate_id = await session.scalar(
        select(AuthoringPromotionCandidate.id).where(
            AuthoringPromotionCandidate.status.in_(("pending", "hold")),
            AuthoringPromotionCandidate.structural_fingerprint == fingerprint,
        )
    )
    if candidate_id is not None:
        return _Duplicate("candidate", str(candidate_id), 1.0, "structural_fingerprint")
    return None


async def _semantic_duplicate(
    session: AsyncSession,
    prepared: _PreparedCandidate,
    embedding: list[float],
    embedding_model: str,
) -> _Duplicate | None:
    example_distance = AuthoringExample.embedding_vertex.cosine_distance(embedding)
    example = (
        await session.execute(
            select(AuthoringExample.example_id, example_distance)
            .where(
                AuthoringExample.active.is_(True),
                AuthoringExample.contract_version == PLAN_CONTRACT_VERSION,
                AuthoringExample.embedding_model == embedding_model,
                AuthoringExample.family == prepared.family,
                AuthoringExample.motif_count == len(prepared.plan.motifs),
                AuthoringExample.embedding_vertex.is_not(None),
            )
            .order_by(example_distance, AuthoringExample.example_id)
            .limit(1)
        )
    ).first()
    candidate_distance = AuthoringPromotionCandidate.embedding_vertex.cosine_distance(embedding)
    candidate = (
        await session.execute(
            select(AuthoringPromotionCandidate.id, candidate_distance)
            .where(
                AuthoringPromotionCandidate.status.in_(("pending", "hold")),
                AuthoringPromotionCandidate.embedding_model == embedding_model,
                AuthoringPromotionCandidate.family == prepared.family,
                AuthoringPromotionCandidate.motif_count == len(prepared.plan.motifs),
                AuthoringPromotionCandidate.embedding_vertex.is_not(None),
            )
            .order_by(candidate_distance, AuthoringPromotionCandidate.id)
            .limit(1)
        )
    ).first()
    nearest: _Duplicate | None = None
    for kind, row in (("example", example), ("candidate", candidate)):
        if row is None:
            continue
        similarity = 1.0 - float(row[1])
        if nearest is None or similarity > nearest.similarity:
            nearest = _Duplicate(kind, str(row[0]), similarity, "vector_similarity")
    if nearest is not None and nearest.similarity >= SEMANTIC_DUPLICATE_THRESHOLD:
        return nearest
    return None


def _candidate_values(
    prepared: _PreparedCandidate,
    *,
    status: str,
    embedding_model: str | None,
    embedding: list[float] | None,
    duplicate: _Duplicate | None = None,
) -> dict[str, Any]:
    source = prepared.source
    assert source.log.prompt is not None
    return {
        "source_key": source.source_key,
        "source_generation_log_id": source.log.id,
        "plan_index": source.plan_index,
        "selected_candidate_id": source.selected_candidate_id,
        "contract_version": source.contract_version,
        "compiler_revision": source.compiler_revision,
        "prompt_revision": source.prompt_revision,
        "family": prepared.family,
        "motif_count": len(prepared.plan.motifs),
        "retrieval_text": source.log.prompt,
        "tags": prepared.tags,
        "plan": prepared.plan.model_dump(mode="json"),
        "structural_fingerprint": prepared.fingerprint,
        "source_digest": prepared.digest,
        "embedding_model": embedding_model,
        "embedding_vertex": embedding,
        "nearest_kind": duplicate.kind if duplicate else None,
        "nearest_id": duplicate.identifier if duplicate else None,
        "nearest_similarity": duplicate.similarity if duplicate else None,
        "status": status,
        "rule_reasons": ([duplicate.reason] if duplicate else ["success", "selected", "finalized"]),
    }


async def _insert(session: AsyncSession, values: dict[str, Any]) -> bool:
    inserted = await session.scalar(
        pg_insert(AuthoringPromotionCandidate)
        .values(**values)
        .on_conflict_do_nothing(index_elements=[AuthoringPromotionCandidate.source_key])
        .returning(AuthoringPromotionCandidate.id)
    )
    await session.commit()
    return inserted is not None


async def _embed_one(
    semaphore: asyncio.Semaphore,
    client: SupportsEmbed,
    prepared: _PreparedCandidate,
) -> list[float]:
    async with semaphore:
        return await client.embed(prepared.document, task_type="RETRIEVAL_DOCUMENT")


async def scan_promotion_candidates(
    session: AsyncSession,
    *,
    embedding_client: SupportsEmbed | None,
    limit: int = DEFAULT_SCAN_LIMIT,
) -> PromotionScanResult:
    """Create reviewable candidates; provider failures remain eligible for a later retry."""

    if embedding_client is None:
        raise AdapterNotConfigured(
            "Vertex embedding is not configured",
            provider="vertex_embedding",
            operation="embed",
            reason_code="not_configured",
        )
    bounded_limit = max(1, min(limit, MAX_SCAN_LIMIT))
    sources = await _source_plans(session, limit=bounded_limit)
    pending = duplicate_count = invalid = failed = 0
    prepared_for_embedding: list[_PreparedCandidate] = []

    for source in sources:
        try:
            prepared = _prepare(source)
        except (AssertionError, TypeError, ValueError):
            raw = json.dumps(source.raw_plan, sort_keys=True, separators=(",", ":"))
            values = {
                "source_key": source.source_key,
                "source_generation_log_id": source.log.id,
                "plan_index": source.plan_index,
                "selected_candidate_id": source.selected_candidate_id,
                "contract_version": PLAN_CONTRACT_VERSION,
                "compiler_revision": source.compiler_revision,
                "prompt_revision": source.prompt_revision,
                "family": "solid",
                "motif_count": 0,
                "retrieval_text": source.log.prompt or "invalid authoring source",
                "tags": [],
                "plan": source.raw_plan,
                "source_digest": hashlib.sha256(raw.encode()).hexdigest(),
                "status": "invalid",
                "rule_reasons": ["plan_contract_invalid"],
            }
            invalid += int(await _insert(session, values))
            continue
        exact = await _exact_duplicate(session, prepared.fingerprint)
        if exact is not None:
            duplicate_count += int(
                await _insert(
                    session,
                    _candidate_values(
                        prepared,
                        status="duplicate",
                        embedding_model=None,
                        embedding=None,
                        duplicate=exact,
                    ),
                )
            )
            continue
        prepared_for_embedding.append(prepared)

    semaphore = asyncio.Semaphore(EMBEDDING_CONCURRENCY)
    results = await asyncio.gather(
        *(_embed_one(semaphore, embedding_client, prepared) for prepared in prepared_for_embedding),
        return_exceptions=True,
    )
    for prepared, embedding in zip(prepared_for_embedding, results, strict=True):
        if isinstance(embedding, BaseException):
            failed += 1
            await session.rollback()
            continue
        semantic = await _semantic_duplicate(
            session,
            prepared,
            embedding,
            embedding_client.model,
        )
        if semantic is not None:
            duplicate_count += int(
                await _insert(
                    session,
                    _candidate_values(
                        prepared,
                        status="duplicate",
                        embedding_model=embedding_client.model,
                        embedding=embedding,
                        duplicate=semantic,
                    ),
                )
            )
            continue
        pending += int(
            await _insert(
                session,
                _candidate_values(
                    prepared,
                    status="pending",
                    embedding_model=embedding_client.model,
                    embedding=embedding,
                ),
            )
        )
    return PromotionScanResult(
        scanned=len(sources),
        pending=pending,
        duplicate=duplicate_count,
        invalid=invalid,
        failed=failed,
    )


async def ensure_candidate_embedding(
    session: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    embedding_client: SupportsEmbed | None,
) -> str:
    """Ensure an approval candidate uses the worker's current embedding model."""

    if embedding_client is None:
        raise AdapterNotConfigured(
            "Vertex embedding is not configured",
            provider="vertex_embedding",
            operation="embed",
            reason_code="not_configured",
        )
    candidate = await session.get(AuthoringPromotionCandidate, candidate_id)
    if candidate is None:
        raise LookupError("candidate_not_found")
    if candidate.status not in {"pending", "hold"}:
        raise ValueError("candidate_not_reviewable")
    if (
        candidate.embedding_model == embedding_client.model
        and candidate.embedding_vertex is not None
    ):
        return embedding_client.model

    document = embedding_document(
        candidate.retrieval_text,
        cast(AuthoringFamily, candidate.family),
        candidate.tags,
    )
    embedding = await embedding_client.embed(document, task_type="RETRIEVAL_DOCUMENT")
    candidate = await session.scalar(
        select(AuthoringPromotionCandidate)
        .where(AuthoringPromotionCandidate.id == candidate_id)
        .with_for_update()
    )
    if candidate is None:
        raise LookupError("candidate_not_found")
    if candidate.status not in {"pending", "hold"}:
        raise ValueError("candidate_not_reviewable")
    candidate.embedding_model = embedding_client.model
    candidate.embedding_vertex = embedding
    await session.commit()
    return embedding_client.model
