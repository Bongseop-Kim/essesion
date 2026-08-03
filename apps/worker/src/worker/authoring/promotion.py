"""Select finalized Plan v3 generations for administrator promotion review."""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any, cast

from db.models.design import GenerationJob
from db.models.seamless import (
    AuthoringExample,
    AuthoringPromotionCandidate,
    SeamlessGenerationLog,
)
from sqlalchemy import exists, select
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
    design_id: str
    raw_plan: dict[str, Any]
    contract_version: int
    compiler_revision: str
    prompt_revision: str

    @property
    def source_key(self) -> str:
        # 생성 1회 = 플랜 1개라 로그 id가 곧 유일 키다.
        return str(self.log.id)


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


def _design_id(log: SeamlessGenerationLog) -> str | None:
    design = log.design
    if not isinstance(design, dict):
        return None
    value = design.get("id")
    return value if isinstance(value, str) else None


async def _finalized_run_ids(session: AsyncSession, run_ids: list[str]) -> set[str]:
    """실사화가 유일한 승격 신호다 — 후보 선택이 없어졌으므로 생성이 곧 선택이다."""
    if not run_ids:
        return set()
    rows = await session.scalars(
        select(GenerationJob.params["run_id"].astext).where(
            GenerationJob.kind == "finalize",
            GenerationJob.status == "succeeded",
            GenerationJob.params["run_id"].astext.in_(run_ids),
        )
    )
    return set(rows)


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
    prelim: list[tuple[SeamlessGenerationLog, str, dict[str, Any]]] = []
    for log in logs:
        design_id = _design_id(log)
        authoring = _safe_authoring(log.intent)
        if design_id is None or authoring is None:
            continue
        if isinstance(authoring.get("plan"), dict):
            prelim.append((log, design_id, authoring))
    finalized = await _finalized_run_ids(session, [str(log.id) for log, _, _ in prelim])
    sources: list[_SourcePlan] = []
    for log, design_id, authoring in prelim:
        if str(log.id) not in finalized:
            continue
        plan = authoring["plan"]
        contract = authoring.get("plan_contract_version")
        compiler = authoring.get("compiler_revision")
        prompt_revision = authoring.get("prompt_revision")
        sources.append(
            _SourcePlan(
                log=log,
                design_id=design_id,
                raw_plan=plan,
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
    example_distance = AuthoringExample.embedding_openai.cosine_distance(embedding)
    example = (
        await session.execute(
            select(AuthoringExample.example_id, example_distance)
            .where(
                AuthoringExample.active.is_(True),
                AuthoringExample.contract_version == PLAN_CONTRACT_VERSION,
                AuthoringExample.embedding_model == embedding_model,
                AuthoringExample.family == prepared.family,
                AuthoringExample.motif_count == len(prepared.plan.motifs),
                AuthoringExample.embedding_openai.is_not(None),
            )
            .order_by(example_distance, AuthoringExample.example_id)
            .limit(1)
        )
    ).first()
    candidate_distance = AuthoringPromotionCandidate.embedding_openai.cosine_distance(embedding)
    candidate = (
        await session.execute(
            select(AuthoringPromotionCandidate.id, candidate_distance)
            .where(
                AuthoringPromotionCandidate.status.in_(("pending", "hold")),
                AuthoringPromotionCandidate.embedding_model == embedding_model,
                AuthoringPromotionCandidate.family == prepared.family,
                AuthoringPromotionCandidate.motif_count == len(prepared.plan.motifs),
                AuthoringPromotionCandidate.embedding_openai.is_not(None),
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
        "design_id": source.design_id,
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
        "embedding_openai": embedding,
        "nearest_kind": duplicate.kind if duplicate else None,
        "nearest_id": duplicate.identifier if duplicate else None,
        "nearest_similarity": duplicate.similarity if duplicate else None,
        "status": status,
        "rule_reasons": ([duplicate.reason] if duplicate else ["success", "finalized"]),
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
        return await client.embed(prepared.document)


async def scan_promotion_candidates(
    session: AsyncSession,
    *,
    embedding_client: SupportsEmbed | None,
    limit: int = DEFAULT_SCAN_LIMIT,
) -> PromotionScanResult:
    """Create reviewable candidates; provider failures remain eligible for a later retry."""

    if embedding_client is None:
        raise AdapterNotConfigured(
            "OpenAI embedding is not configured",
            provider="openai_embedding",
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
                "design_id": source.design_id,
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
            "OpenAI embedding is not configured",
            provider="openai_embedding",
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
        and candidate.embedding_openai is not None
    ):
        return embedding_client.model

    document = embedding_document(
        candidate.retrieval_text,
        cast(AuthoringFamily, candidate.family),
        candidate.tags,
    )
    embedding = await embedding_client.embed(document)
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
    candidate.embedding_openai = embedding
    await session.commit()
    return embedding_client.model
