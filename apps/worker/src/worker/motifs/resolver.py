"""정확도 우선 모티프 검색·해석 래더 (worker-motifs.md §5).

흐름: 원문/semantic descriptor → 공개 카탈로그 전체 lexical+pgvector top-k →
신뢰도 게이트 → generate-on-miss. scope는 검색 하드 필터로 사용하지 않는다.
모든 hit은 variant_group 재사용 풀을 거쳐 seed 샘플링된다.
프로세스-로컬 캐시는 두지 않는다 — content-hash upsert + 요청 스코프만이 상태.
"""

from __future__ import annotations

import copy
import logging
import math
import re
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
    facets_from_spec,
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
    subject: str | None = None
    match_type: str | None = None


@dataclass(frozen=True)
class CatalogMatch:
    meta: MotifMeta
    similarity: float
    match_type: str


@dataclass(frozen=True)
class CatalogRetrieval:
    matches: list[CatalogMatch]
    query_vec: list[float] | None


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
    """검색과 backfill이 공유하는 facet 순서. scope는 의도적으로 제외한다."""
    return store.embedding_document(
        subject=spec.get("subject"),
        description=spec.get("description"),
        style=spec.get("style"),
        view=spec.get("view"),
        expression=spec.get("expression"),
        tags=spec.get("tags") or (),
    )


def _cosine(a: list[float], b: list[float]) -> float:
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return sum(x * y for x, y in zip(a, b, strict=False)) / (na * nb)


def _tokens(value: str) -> set[str]:
    tokens = set(
        re.findall(r"[^\W_]+", store.normalize_facet(value), flags=re.UNICODE)
    )
    aliases = {
        "꽃": "flower",
        "플라워": "flower",
        "잎": "leaf",
        "나뭇잎": "leaf",
        "체스": "chess",
        "새": "bird",
        "나비": "butterfly",
        "별": "star",
        "구름": "cloud",
        "태양": "sun",
        "달": "moon",
        "강아지": "dog",
        "고양이": "cat",
    }
    tokens.update(aliases[token] for token in tuple(tokens) if token in aliases)
    return tokens


def _lexical_match(query_tokens: set[str], meta: MotifMeta) -> bool:
    terms = _tokens(meta.subject or "")
    for tag in meta.tags:
        terms |= _tokens(tag)
    return bool(query_tokens & terms)


async def retrieve_catalog(
    session: AsyncSession,
    text: str,
    *,
    embedding_client,
    tau: float,
    top_k: int = 5,
) -> CatalogRetrieval:
    """공개 카탈로그에서 exact token 또는 τ 이상 vector 결과만 반환한다."""
    catalog = await _read_or(lambda: store.find_catalog(session), [], session, "find_catalog")
    if not catalog or not text.strip():
        return CatalogRetrieval([], None)

    by_id = {meta.id: meta for meta in catalog}
    ranked: list[CatalogMatch] = []
    seen: set[str] = set()
    query_tokens = _tokens(text)
    for meta in catalog:
        if _lexical_match(query_tokens, meta):
            ranked.append(CatalogMatch(meta, 1.0, "exact_token"))
            seen.add(meta.id)
            if len(ranked) >= top_k:
                return CatalogRetrieval(ranked, None)

    try:
        query_vec = await embed_query(text, client=embedding_client)
    except EmbeddingError:
        logger.warning("motif query embedding failed — exact token matches only", exc_info=True)
        query_vec = None
    if query_vec is not None:
        nearest = await _read_or(
            lambda: store.nearest_by_embedding(session, query_vec, top_k=top_k),
            [],
            session,
            "nearest_by_embedding",
        )
        for match in nearest:
            if match.id in seen or match.similarity < tau:
                continue
            meta = by_id.get(match.id)
            if meta is None:
                continue
            ranked.append(CatalogMatch(meta, match.similarity, "embedding"))
            seen.add(meta.id)
            if len(ranked) >= top_k:
                break
    return CatalogRetrieval(ranked, query_vec)


async def prompt_catalog_candidates(
    session: AsyncSession,
    prompt: str,
    *,
    embedding_client,
    tau: float,
    top_k: int = 5,
) -> list[dict[str, object]]:
    """Gemini grounding용 후보. provider에는 실제 motif ID 대신 catalog_ref만 전달한다."""
    retrieval = await retrieve_catalog(
        session,
        prompt,
        embedding_client=embedding_client,
        tau=tau,
        top_k=top_k,
    )
    return [
        {
            "catalog_ref": f"catalog_{index}",
            "motif_id": match.meta.id,
            "subject": match.meta.subject,
            "description": match.meta.description,
            "style": match.meta.style,
            "similarity": match.similarity,
            "match_type": match.match_type,
        }
        for index, match in enumerate(retrieval.matches, start=1)
    ]


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
    authored_spec = {**spec, "scope": "whole"}
    retrieval = await retrieve_catalog(
        session,
        descriptor_text(authored_spec),
        embedding_client=embedding_client,
        tau=tau,
    )
    if retrieval.matches:
        match = retrieval.matches[0]
        selected = await _select_variant(
            session,
            match.meta.variant_group,
            seed,
            match.meta.id,
            retrieval.query_vec,
            tau,
        )
        return ResolveResult(
            selected,
            reused=True,
            similarity=match.similarity,
            subject=match.meta.subject,
            match_type=match.match_type,
        )

    # 신뢰도 게이트 miss → Recraft 생성. 자동 저작 모티프는 whole로 저장한다.
    normalized = await generate_motif(authored_spec, client=recraft_client, settings=settings)
    motif_id = await store.upsert_motif(
        session,
        normalized,
        facets=facets_from_spec(authored_spec),
        embedding=retrieval.query_vec,
        source="recraft",
        variant_group=variant_group_key(authored_spec.get("subject"), "whole"),
    )
    return ResolveResult(
        motif_id,
        reused=False,
        similarity=None,
        subject=authored_spec.get("subject"),
        match_type="recraft",
    )


async def present_candidates(
    session: AsyncSession,
    spec: dict,
    *,
    embedding_client,
    top_k: int,
    tau: float = 0.84,
) -> list[dict]:
    """게이트 UI용 read-only 후보. 같은 정확도 게이트를 쓰며 Recraft는 호출하지 않는다."""
    retrieval = await retrieve_catalog(
        session,
        descriptor_text(spec),
        embedding_client=embedding_client,
        tau=tau,
        top_k=top_k,
    )
    return [
        _candidate_dict(match.meta, round(match.similarity, 4))
        for match in retrieval.matches
    ]


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
    required_failed: set[str] = set()
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
            if spec.get("required") is True:
                required_failed.add(lid)
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
            if spec.get("required") is True:
                required_failed.add(lid)
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
            catalog_source = (
                "reference_catalog"
                if spec.get("reference_image_index") is not None
                else "prompt_catalog"
            )
            trace.append(
                {
                    "layer_id": lid,
                    "subject": result.subject or spec.get("subject"),
                    "scope": "whole",
                    "outcome": catalog_source if result.reused else "recraft",
                    "motif_id": result.motif_id,
                    "similarity": result.similarity,
                    "match_type": result.match_type,
                }
            )

    if required_failed:
        raise AdapterClientError(
            f"required motif spec(s) failed to resolve: {', '.join(sorted(required_failed))}",
            provider=last_failure.provider if last_failure else "worker",
            operation=last_failure.operation if last_failure else "resolve_motif",
            reason_code=last_failure.reason_code if last_failure else "motif_resolution_failed",
            status_code=last_failure.status_code if last_failure else None,
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
