"""결정론적 모티프 해석 래더 (worker-motifs.md §5).

흐름: spec → exact facet match → scope 하드 필터 → 임베딩 τ 게이트 → generate-on-miss.
모든 hit은 variant_group 재사용 풀을 거쳐(쿼리 임베딩으로 τ-스코핑) seed 샘플링된다.
프로세스-로컬 캐시는 두지 않는다 — content-hash upsert + 요청 스코프만이 상태.
"""

from __future__ import annotations

import copy
import logging
import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from worker.adapters import AdapterClientError
from worker.adapters.embedding import EmbeddingError, embed_query
from worker.adapters.recraft import generate_motif
from worker.engine import determinism
from worker.motifs import store
from worker.motifs.store import (
    MotifMeta,
    exact_facet_key,
    facets_from_spec,
    normalize_facet,
    variant_group_key,
)

logger = logging.getLogger(__name__)

# glyph(텍스트-as-모티프)·vectorize(이미지) 파이프라인 미구현 — 해당 spec이 Recraft 생성
# 래더로 흘러 subject 없는 프롬프트가 되지 않게 명시 거부한다 (spec §5·§7, 5단계에서 구현).
UNSUPPORTED_SPEC_FIELDS = ("text", "source_image_index")


@dataclass(frozen=True)
class ResolveResult:
    motif_id: str
    reused: bool
    similarity: float | None


async def _read_or[T](
    read: Callable[[], Awaitable[T]], fallback: T, session: AsyncSession, what: str
) -> T:
    """store 읽기의 일시 오류를 miss로 흡수 — 재생성은 content-hash upsert로 멱등이라 정합.

    읽기만 savepoint로 격리해 같은 요청에서 앞서 쓴 미커밋 motif는 보존한다. 쓰기(upsert)
    오류나 savepoint로 복구할 수 없는 세션 오류는 이후 쓰기에서 전파한다.
    """
    try:
        async with session.begin_nested():
            return await read()
    except SQLAlchemyError:
        logger.warning("motif store read failed (%s) — treated as miss", what, exc_info=True)
        return fallback


def descriptor_text(spec: dict) -> str:
    """임베딩 소스 텍스트 (§4): description 우선, 없으면 facet에서 합성. scope는 의도적 제외."""
    description = (spec.get("description") or "").strip()
    if description:
        return description
    subject = (spec.get("subject") or "").strip()
    expression = (spec.get("expression") or "").strip()
    style = (spec.get("style") or "").strip()
    view = (spec.get("view") or "").strip()
    head = " ".join(t for t in (expression, subject) if t)
    view_clause = f"{view} view" if view else ""
    return ", ".join(seg for seg in (head, view_clause, style) if seg)


def _cosine(a: list[float], b: list[float]) -> float:
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return sum(x * y for x, y in zip(a, b, strict=False)) / (na * nb)


def _exact_match(spec: dict, candidates: list[MotifMeta]) -> MotifMeta | None:
    """정규화 디스크립터가 완전히 일치하는 후보(ORDER BY id 이므로 안정), 없으면 None."""
    want = exact_facet_key(spec)
    for rec in candidates:
        if exact_facet_key(rec) == want:
            return rec
    return None


async def _select_variant(
    session: AsyncSession,
    variant_group: str | None,
    seed: int,
    fallback_id: str,
    query_vec: list[float] | None,
    tau: float,
) -> str:
    """그룹 재사용 풀에서 seed 샘플 하나, 없으면 fallback_id.

    query_vec이 있으면 τ 미만의 비교가능 멤버는 배제(fallback·임베딩 없는 멤버는 항상 유지) —
    (subject, scope)만 공유하는 의미 다른 형제가 매치 대신 뽑히지 않게.
    """
    if not variant_group:
        return fallback_id
    members = await _read_or(
        lambda: store.find_variant_pool(session, variant_group),
        [],
        session,
        "find_variant_pool",
    )
    if query_vec is None:
        pool = [m.id for m in members]
    else:
        pool = [
            m.id
            for m in members
            if m.id == fallback_id
            or not m.embedding
            or len(m.embedding) != len(query_vec)
            or _cosine(m.embedding, query_vec) >= tau
        ]
    if not pool:
        return fallback_id
    return determinism.select_variant(pool, variant_group, seed)


async def resolve_spec(
    session: AsyncSession,
    spec: dict,
    *,
    recraft_client,
    embedding_client,
    settings,
    seed: int,
) -> ResolveResult:
    """단일 spec 해석 래더. 래더 히트면 reused=True(Recraft 스킵), miss면 generate 후 upsert."""
    tau = settings.motif_similarity_tau
    scope = normalize_facet(spec.get("scope"))
    query_vec: list[float] | None = None
    best_sim: float | None = None
    if scope:
        candidates = await _read_or(
            lambda: store.find_by_scope(session, scope), [], session, "find_by_scope"
        )
        if candidates:
            query_vec = await embed_query(descriptor_text(spec), client=embedding_client)
            exact = _exact_match(spec, candidates)
            if exact is not None:
                selected = await _select_variant(
                    session, exact.variant_group, seed, exact.id, query_vec, tau
                )
                return ResolveResult(selected, reused=True, similarity=1.0)
            match = None
            if query_vec is not None:
                match = await _read_or(
                    lambda: store.nearest_by_embedding(session, query_vec, scope=scope),
                    None,
                    session,
                    "nearest_by_embedding",
                )
            if match is None:
                fallback = min(candidates, key=lambda c: c.id)
                selected = await _select_variant(
                    session, fallback.variant_group, seed, fallback.id, query_vec, tau
                )
                return ResolveResult(selected, reused=True, similarity=None)
            best_sim = match.similarity
            if best_sim >= tau:
                selected = await _select_variant(
                    session, match.variant_group, seed, match.id, query_vec, tau
                )
                return ResolveResult(selected, reused=True, similarity=best_sim)
    # miss (또는 facet 없음) → Recraft 생성 + 쿼리 임베딩과 함께 upsert
    normalized = await generate_motif(spec, client=recraft_client, settings=settings)
    motif_id = await store.upsert_motif(
        session,
        normalized,
        facets=facets_from_spec(spec),
        embedding=query_vec,
        source="recraft",
        variant_group=variant_group_key(spec.get("subject"), spec.get("scope")),
    )
    return ResolveResult(motif_id, reused=False, similarity=best_sim)


async def present_candidates(
    session: AsyncSession,
    spec: dict,
    *,
    embedding_client,
    top_k: int,
) -> list[dict]:
    """게이트 UI용 무료 재사용 후보 — 래더의 read-only 대응물(Recraft 절대 호출 안 함).

    exact(sim 1.0) → best embedding(round 4) → scope 풀을 id순으로 채움(sim None).
    """
    scope = normalize_facet(spec.get("scope"))
    if not scope:
        return []
    candidates = await _read_or(
        lambda: store.find_by_scope(session, scope), [], session, "find_by_scope"
    )
    if not candidates:
        return []
    ranked: list[tuple[MotifMeta, float | None]] = []
    seen: set[str] = set()
    exact = _exact_match(spec, candidates)
    if exact is not None:
        ranked.append((exact, 1.0))
        seen.add(exact.id)
    try:
        query_vec = await embed_query(descriptor_text(spec), client=embedding_client)
    except EmbeddingError:
        query_vec = None  # 게이트 UI에서 임베딩 장애는 소프트 실패
    if query_vec is not None:
        match = await _read_or(
            lambda: store.nearest_by_embedding(session, query_vec, scope=scope),
            None,
            session,
            "nearest_by_embedding",
        )
        if match is not None and match.id not in seen:
            meta = next((c for c in candidates if c.id == match.id), None)
            if meta is not None:
                ranked.append((meta, round(match.similarity, 4)))
                seen.add(match.id)
    for rec in candidates:
        if len(ranked) >= top_k:
            break
        if rec.id not in seen:
            ranked.append((rec, None))
            seen.add(rec.id)
    return [_candidate_dict(meta, sim) for meta, sim in ranked[:top_k]]


def _candidate_dict(meta: MotifMeta, similarity: float | None) -> dict:
    return {
        "motif_id": meta.id,
        "similarity": similarity,
        "subject": meta.subject,
        "scope": meta.scope,
        "view": meta.view,
        "style": meta.style,
        "description": meta.description,
        "source": meta.source,
    }


async def resolve_motifs(
    session: AsyncSession,
    intent: dict,
    motif_specs: list[dict],
    *,
    recraft_client,
    embedding_client,
    settings,
    seed: int,
    warnings: list[str] | None = None,
    trace: list[dict[str, object]] | None = None,
) -> dict:
    """intent 사본의 각 모티프 레이어 params.motif_id를 해석해 반환 (§5 오케스트레이션).

    레이어별 게이트 소진 시 그 layer drop(+host cascade, fixpoint). 전부 실패면
    AdapterClientError(→502), 생존자 있으면 부분 성공(경고 append).
    """
    if not motif_specs:
        return intent
    sink = warnings if warnings is not None else []
    resolved = copy.deepcopy(intent)
    layers_by_id = {
        layer.get("id"): layer for layer in resolved.get("layers", []) if isinstance(layer, dict)
    }
    attempted: set[str] = set()
    failed: set[str] = set()
    reasons: dict[str, str] = {}
    last_failure: AdapterClientError | None = None
    for spec in motif_specs:
        layer = layers_by_id.get(spec.get("layer_id"))
        if layer is None or layer.get("type") != "motif":
            continue
        lid = str(layer.get("id"))
        attempted.add(lid)
        unsupported = [f for f in UNSUPPORTED_SPEC_FIELDS if spec.get(f) is not None]
        if unsupported:
            failed.add(lid)
            reasons[lid] = f"unsupported spec field(s) {', '.join(unsupported)} (not implemented)"
            if trace is not None:
                trace.append(
                    {
                        "layer_id": lid,
                        "subject": spec.get("subject"),
                        "scope": spec.get("scope"),
                        "outcome": "dropped",
                        "reason_code": "unsupported_spec",
                    }
                )
            continue
        try:
            result = await resolve_spec(
                session,
                spec,
                recraft_client=recraft_client,
                embedding_client=embedding_client,
                settings=settings,
                seed=seed,
            )
        except AdapterClientError as exc:
            last_failure = exc
            failed.add(lid)
            reasons[lid] = (
                f"Tier-1 gate exhausted ({spec.get('subject', '?')}/{spec.get('scope', '?')})"
            )
            failure = {
                "layer_id": lid,
                "subject": spec.get("subject"),
                "scope": spec.get("scope"),
                "outcome": "dropped",
                "provider": exc.provider,
                "operation": exc.operation,
                "reason_code": exc.reason_code,
                "status_code": exc.status_code,
            }
            if trace is not None:
                trace.append(failure)
            logger.warning(
                "motif resolution provider call failed",
                extra={
                    "event": "provider_call_failed",
                    "stage": "motif_resolution",
                    "provider": exc.provider,
                    "operation": exc.operation,
                    "reason_code": exc.reason_code,
                    "status_code": exc.status_code,
                },
            )
            continue
        layer.setdefault("params", {})["motif_id"] = result.motif_id
        if trace is not None:
            trace.append(
                {
                    "layer_id": lid,
                    "subject": spec.get("subject"),
                    "scope": spec.get("scope"),
                    "outcome": (
                        "recraft"
                        if not result.reused
                        else "exact"
                        if result.similarity == 1.0
                        else "catalog_fallback"
                        if result.similarity is None
                        else "embedding_reuse"
                    ),
                    "motif_id": result.motif_id,
                    "similarity": result.similarity,
                }
            )

    if not failed:
        return resolved
    if not (attempted - failed):
        raise AdapterClientError(
            f"all {len(attempted)} motif spec(s) failed to resolve",
            provider=last_failure.provider if last_failure else "worker",
            operation=last_failure.operation if last_failure else "resolve_motif",
            reason_code=last_failure.reason_code if last_failure else "motif_resolution_failed",
            status_code=last_failure.status_code if last_failure else None,
        )

    dropped = set(failed)
    while True:
        grew = False
        for layer in resolved.get("layers", []):
            lid = str(layer.get("id"))
            if lid in dropped:
                continue
            host = (layer.get("placement") or {}).get("host_layer")
            if host in dropped:
                dropped.add(lid)
                reasons[lid] = f"host_layer {host!r}"
                grew = True
        if not grew:
            break

    survivors = [
        layer for layer in resolved.get("layers", []) if str(layer.get("id")) not in dropped
    ]
    if not survivors:
        raise AdapterClientError(
            "motif drop cascade left no composable layers",
            provider=last_failure.provider if last_failure else "worker",
            operation=last_failure.operation if last_failure else "resolve_motif",
            reason_code=last_failure.reason_code if last_failure else "motif_resolution_failed",
            status_code=last_failure.status_code if last_failure else None,
        )
    for layer in resolved.get("layers", []):
        lid = str(layer.get("id"))
        if lid not in dropped:
            continue
        if lid in failed:
            sink.append(f"motif layer {lid!r} dropped — {reasons[lid]}")
        else:
            sink.append(f"layer {lid!r} dropped because its {reasons[lid]} was dropped")
    resolved["layers"] = survivors
    return resolved
