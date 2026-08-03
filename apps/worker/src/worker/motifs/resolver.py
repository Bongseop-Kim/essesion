"""명시적 모티프 검색·생성용 정확도 우선 resolver (worker-motifs.md §5).

모티프 모달 요청에서 원문/semantic descriptor → 공개 카탈로그 lexical+pgvector top-k →
신뢰도 게이트를 적용하고, 사용자가 생성을 승인한 경로만 miss에서 Recraft를 호출한다.
디자인 `/generate`는 이 resolver의 generate-on-miss 경로를 사용하지 않는다.
"""

from __future__ import annotations

import logging
import math
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from svg_safety import is_suspicious_facet_text, sanitize_facet_text

from worker.adapters import AdapterClientError
from worker.adapters.embedding import EmbeddingError, embed_query
from worker.adapters.recraft import RecraftError, generate_motif
from worker.engine import determinism
from worker.motifs import store
from worker.motifs.store import (
    MotifMeta,
    facets_from_spec,
    variant_group_key,
)

logger = logging.getLogger(__name__)

# recraft 유입 facet 자유텍스트 — 임베딩·저장 전 살균할 필드 (scope는 whole/partial로 제약됨).
_SCREENED_FACETS = ("subject", "description", "style", "view", "expression")


def _screen_facets(spec: dict, *, reject_suspicious: bool = False) -> dict:
    """관리자 게이트 없는 recraft 카탈로그 유입의 유일 자동 방어선 (C-10).

    비가시·제어 문자를 제거하고 명령형 인젝션 패턴은 유입 전에 거부한다.
    """
    screened = dict(spec)
    for key in _SCREENED_FACETS:
        value = screened.get(key)
        if isinstance(value, str):
            clean_value = sanitize_facet_text(value)
            if is_suspicious_facet_text(clean_value):
                logger.warning("motif facet %r tripped prompt-injection heuristic on ingress", key)
                if reject_suspicious:
                    raise AdapterClientError(
                        "generated motif facet failed the ingress safety screen",
                        provider="worker",
                        operation="screen_motif",
                        reason_code="unsafe_motif_facet",
                    )
            screened[key] = clean_value
    tags = screened.get("tags")
    if isinstance(tags, (list, tuple)):
        clean_tags: list[str] = []
        for tag in tags:
            if not isinstance(tag, str):
                continue
            clean_tag = sanitize_facet_text(tag)
            if is_suspicious_facet_text(clean_tag):
                logger.warning("motif tag tripped prompt-injection heuristic on ingress")
                if reject_suspicious:
                    raise AdapterClientError(
                        "generated motif facet failed the ingress safety screen",
                        provider="worker",
                        operation="screen_motif",
                        reason_code="unsafe_motif_facet",
                    )
            clean_tags.append(clean_tag)
        screened["tags"] = clean_tags
    return screened


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


@dataclass
class MotifGenerationBudget:
    """Request-scoped cap over actual Recraft calls, including suitability retries."""

    limit: int
    used: int = 0

    def reserve(self) -> bool:
        if self.used >= self.limit:
            return False
        self.used += 1
        return True


@dataclass(frozen=True)
class _BudgetedRecraftClient:
    client: object
    budget: MotifGenerationBudget

    async def generate(
        self,
        prompt: str,
        *,
        seed: int | None = None,
    ) -> str:
        if not self.budget.reserve():
            raise RecraftError(
                "request motif generation budget exhausted",
                provider="worker",
                operation="resolve_motif",
                reason_code="motif_generation_budget_exhausted",
            )
        return await self.client.generate(  # type: ignore[attr-defined]
            prompt,
            seed=seed,
        )


def _provenance_uuid(provenance: dict | None, key: str) -> uuid.UUID | None:
    value = provenance.get(key) if provenance else None
    if value is None:
        return None
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


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
    """검색과 초기 인덱싱이 공유하는 facet 순서. scope는 의도적으로 제외한다."""
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


_HANGUL_RE = re.compile(r"[가-힣]")

# 한국어 명사 뒤 조사(격·보조사). 우리 사용자는 전부 한국인이라 "펠리컨을/꿀벌을/원으로"처럼
# 조사를 붙여 쓰는데, seed 모티프는 임베딩이 없어(embedding_vertex NULL) 카탈로그 grounding이
# lexical exact-token만 된다 → 조사가 붙으면 "펠리컨을" ≠ 태그 "펠리컨"으로 조용히 miss한다.
# 아래 목록으로 토큰 끝의 조사 1개만 떼어 어간 토큰을 추가한다(원문 토큰은 보존).
# 오매칭 방지 가드: (1) 한글 토큰에만, (2) 목록에 정확히 일치하는 접미사만, 가장 긴 것 우선,
# (3) 어간이 비지 않고(≥1자) 한글 음절을 포함할 때만. 토큰 "전체"의 끝 조사만 떼므로
# "정원을"→"정원"(≠"원")처럼 부분문자열 오매칭은 발생하지 않는다(단어 경계는 토큰화가 보장).
# 남는 한계: "별도(따로)"=별+도, "원만(圓滿)"=원+만처럼 통째로 다른 뜻인 합성어는 어간이 태그와
# 겹칠 수 있으나, 넥타이 패턴 프롬프트 도메인에서는 극히 드물어 recall 이득이 훨씬 크다.
_KOREAN_PARTICLES: tuple[str, ...] = tuple(
    sorted(
        {
            # 3음절
            "으로써",
            "으로서",
            "에게서",
            # 2음절 격·보조사 + 구어 접속/열거조사(이랑/하고/이나)
            "으로",
            "에서",
            "에게",
            "한테",
            "에는",
            "에도",
            "까지",
            "부터",
            "만을",
            "만이",
            "만은",
            "이랑",
            "하고",
            # 1음절 고빈도 격·보조사 + 구어 접속조사(랑) — 모음/자음 종성 모두 커버(나비랑/꿀벌이랑)
            "을",
            "를",
            "은",
            "는",
            "이",
            "가",
            "과",
            "와",
            "도",
            "만",
            "의",
            "에",
            "로",
            "랑",
        },
        key=len,
        reverse=True,
    )
)

# 조사 절단을 금지할 통짜 토큰. 1음절 태그(별/새/말/달)와 동형인 고빈도 부사·의태어·용언이라
# 조사로 오인해 어간을 떼면 엉뚱한 seed로 grounding된다: "별로"(그다지)→별, "새로"(새롭게)→새,
# "달랑"(꼴랑)→달, "말랑"(말랑말랑)→말, "말하고"(말하다)→말. 문서화된 별도/원만 잔여 오탐과 같은
# 부류지만 스타일/패턴 프롬프트에서 빈도가 높아 명시 차단한다(완전 열거는 불가 — 대표 고빈도만).
# 조사 목록에서 '로'/'랑'을 빼면 "격자로"→"격자", "나비랑"→"나비"가 깨지므로 통짜 차단이 맞다.
_PARTICLE_STRIP_DENY: frozenset[str] = frozenset(
    {"별로", "별도", "새로", "말로", "원만", "배로", "달랑", "말랑", "말하고"}
)


def _strip_korean_particle(token: str) -> str | None:
    """한글 토큰 끝의 조사 1개를 떼어 어간을 돌려준다(없거나 과절단이면 None)."""
    if token in _PARTICLE_STRIP_DENY or not _HANGUL_RE.search(token):
        return None
    for particle in _KOREAN_PARTICLES:  # 가장 긴 조사 우선 (예: "으로" > "로")
        if len(token) > len(particle) and token.endswith(particle):
            stem = token[: -len(particle)]
            return stem if _HANGUL_RE.search(stem) else None
    return None


def _tokens(value: str) -> set[str]:
    tokens = set(re.findall(r"[^\W_]+", store.normalize_facet(value), flags=re.UNICODE))
    # 조사형 프롬프트 grounding: 끝 조사를 뗀 어간을 토큰에 합류시킨다(원문 토큰은 유지).
    tokens.update(
        stem for token in tuple(tokens) if (stem := _strip_korean_particle(token)) is not None
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
            "view": match.meta.view,
            "expression": match.meta.expression,
            "scope": match.meta.scope,
            "tags": list(match.meta.tags),
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
    provenance: dict | None = None,
    generation_budget: MotifGenerationBudget | None = None,
    upsert_sessionmaker: async_sessionmaker[AsyncSession] | None = None,
) -> ResolveResult:
    """단일 spec 해석 래더. 래더 히트면 reused=True(Recraft 스킵), miss면 generate 후 upsert.

    upsert_sessionmaker가 있으면 upsert를 전용 세션에서 즉시 커밋한다 — 이후 요청이
    실패해도 과금된 Recraft 결과물이 카탈로그 자산으로 남아 재시도가 무료 재사용된다.
    """
    tau = settings.motif_similarity_tau
    authored_spec = _screen_facets(
        {**spec, "scope": "whole"},
        reject_suspicious=True,
    )
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
    effective_recraft = recraft_client
    if recraft_client is not None and generation_budget is not None:
        effective_recraft = _BudgetedRecraftClient(recraft_client, generation_budget)
    normalized = await generate_motif(
        authored_spec,
        client=effective_recraft,
        settings=settings,
        seed=seed,
    )

    kwargs: dict = dict(
        facets=facets_from_spec(authored_spec),
        embedding=retrieval.query_vec,
        source="recraft",
        variant_group=variant_group_key(authored_spec.get("subject"), "whole"),
        ingested_user_id=_provenance_uuid(provenance, "user_id"),
        ingested_session_id=_provenance_uuid(provenance, "session_id"),
    )
    if upsert_sessionmaker is None:
        await store.upsert_motif(session, normalized, **kwargs)
    else:
        # 전용 세션 = 독립 트랜잭션 — 이후 요청이 실패해도 과금된 결과물이 카탈로그에 남는다.
        async with upsert_sessionmaker() as upsert_session:
            await store.upsert_motif(upsert_session, normalized, **kwargs)
            await upsert_session.commit()
    return ResolveResult(
        normalized.id,
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
    return [_candidate_dict(match.meta, round(match.similarity, 4)) for match in retrieval.matches]


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
