"""모티프 카탈로그 검색·명시적 생성 (worker-motifs.md §5).

검색(candidates·grounding)은 공개 카탈로그 lexical+pgvector top-k에 신뢰도 게이트를
적용한다. 생성(`resolve_spec`)은 카탈로그 확인 없이 항상 GPT Image를 호출한다 — 비슷한
모티프 확인은 검색 단계가 이미 눈에 보이게 수행하며, 숨은 재사용 판정은 두지 않는다.
"""

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from svg_safety import is_suspicious_facet_text, sanitize_facet_text

from worker.adapters import AdapterClientError
from worker.adapters.embedding import EmbeddingError, embed_query
from worker.adapters.gpt_image import GPTImageError, generate_motif
from worker.motifs import store
from worker.motifs.categories import CATEGORY_WORDS
from worker.motifs.store import MotifMeta, facets_from_spec

logger = logging.getLogger(__name__)

# 생성 유입 facet 자유텍스트 — 임베딩·저장 전 살균할 필드 (scope는 whole/partial로 제약됨).
_SCREENED_FACETS = ("subject", "description", "style")


def _screen_facets(spec: dict, *, reject_suspicious: bool = False) -> dict:
    """GPT Image pending 유입의 1차 자동 방어선 (C-10).

    비가시·제어 문자를 제거하고 명령형 인젝션 패턴은 저장 전에 거부한다. 통과한 행도
    관리자 승인 전에는 공개 카탈로그에 들어가지 않는다.
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
class CatalogMatch:
    meta: MotifMeta
    similarity: float
    match_type: str


@dataclass
class MotifGenerationBudget:
    """Request-scoped cap over actual image calls, including suitability retries."""

    limit: int
    used: int = 0

    def reserve(self) -> bool:
        if self.used >= self.limit:
            return False
        self.used += 1
        return True


@dataclass(frozen=True)
class _BudgetedImageClient:
    client: object
    budget: MotifGenerationBudget

    async def generate(
        self,
        prompt: str,
        *,
        seed: int | None = None,
    ) -> bytes:
        if not self.budget.reserve():
            raise GPTImageError(
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
        tags=spec.get("tags") or (),
    )


_HANGUL_RE = re.compile(r"[가-힣]")

# 한국어 명사 뒤 조사(격·보조사). 우리 사용자는 전부 한국인이라 "펠리컨을/꿀벌을/원으로"처럼
# 조사를 붙여 쓰는데, seed 모티프는 임베딩이 없어(embedding_openai NULL) 카탈로그 grounding이
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


def _lexical_terms(meta: MotifMeta) -> tuple[set[str], set[str]]:
    """(고유어, 카테고리어) — 카테고리 태그는 상위어라 매칭 tier를 나눠 쓴다.

    "동물"·"바다" 같은 카테고리는 한 번에 수십 건을 끌어온다. 고유어와 같은 층에 두면
    유사도 순위를 가진 벡터 결과를 밀어내고 ID(content-hash) 임의 순서가 그 자리를 차지한다.
    """
    own = _tokens(meta.subject or "")
    category: set[str] = set()
    for tag in meta.tags:
        (category if store.normalize_facet(tag) in CATEGORY_WORDS else own).update(_tokens(tag))
    return own, category


# prefix 매칭 최소 길이 — 1자를 허용하면 한글 오매칭이 폭발한다("새"→새우, "말"→말랑).
# 양방향으로 본다: "테니"→테니스, 그리고 한국어 복합어가 한 토큰이라 "바다동물"→바다.
# 시트 전용이라 오매칭 한 장을 감수한다 (측정·근거: docs/reviews/motif-search-derag-2026-08-17.md).
_PREFIX_MIN_LEN = 2


def _prefix_match(query_tokens: set[str], terms: set[str]) -> bool:
    tokens = [token for token in query_tokens if len(token) >= _PREFIX_MIN_LEN]
    long_terms = [term for term in terms if len(term) >= _PREFIX_MIN_LEN]
    return any(
        term.startswith(token) or token.startswith(term) for term in long_terms for token in tokens
    )


async def retrieve_catalog(
    session: AsyncSession,
    text: str,
    *,
    embedding_client,
    tau: float,
    top_k: int = 5,
) -> list[CatalogMatch]:
    """공개 카탈로그에서 lexical 일치 또는 τ 이상 vector 결과만 반환한다.

    채우는 순서가 계약이다 — **고유어 → 벡터 → 카테고리**. 카테고리 상위어는 수십 건을
    한 번에 끌어오므로 벡터가 답을 못 낼 때만 쓰는 폴백으로 내린다 (worker-motifs.md §5).

    `embedding_client=None`(시트 전용)이면 벡터 다리 없이 lexical만 돌고, 각 tier의 exact
    뒤에 같은 tier의 prefix 일치를 붙인다 — exact가 항상 앞선다.
    """
    catalog = await _read_or(lambda: store.find_catalog(session), [], session, "find_catalog")
    if not catalog or not text.strip():
        return []

    by_id = {meta.id: meta for meta in catalog}
    ranked: list[CatalogMatch] = []
    seen: set[str] = set()
    query_tokens = _tokens(text)
    terms_by_id = {meta.id: _lexical_terms(meta) for meta in catalog}
    prefix = embedding_client is None

    def collect(pick, match_type: str) -> bool:
        """조건에 맞는 모티프를 ID 순으로 담는다 — top_k가 차면 True."""
        for meta in catalog:
            if meta.id in seen or not pick(terms_by_id[meta.id]):
                continue
            ranked.append(CatalogMatch(meta, 1.0, match_type))
            seen.add(meta.id)
            if len(ranked) >= top_k:
                return True
        return False

    # tier 1 — 고유어(subject·파일명 토큰·한글 동의어).
    if collect(lambda terms: query_tokens & terms[0], "exact_token"):
        return ranked
    if prefix and collect(lambda terms: _prefix_match(query_tokens, terms[0]), "prefix_token"):
        return ranked

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
                return ranked

    # tier 2 — 카테고리 상위어. 고유어도 벡터도 자리를 못 채웠을 때만 내려온다.
    if collect(lambda terms: query_tokens & terms[1], "category_token"):
        return ranked
    if prefix:
        collect(lambda terms: _prefix_match(query_tokens, terms[1]), "category_prefix")
    return ranked


async def prompt_catalog_candidates(
    session: AsyncSession,
    prompt: str,
    *,
    embedding_client,
    tau: float,
    top_k: int = 5,
) -> list[dict[str, object]]:
    """LLM grounding용 후보. provider에는 실제 motif ID 대신 catalog_ref만 전달한다."""
    matches = await retrieve_catalog(
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
            "scope": match.meta.scope,
            "tags": list(match.meta.tags),
            "similarity": match.similarity,
            "match_type": match.match_type,
        }
        for index, match in enumerate(matches, start=1)
    ]


async def resolve_spec(
    session: AsyncSession,
    spec: dict,
    *,
    gpt_image_client,
    settings,
    seed: int,
    provenance: dict | None = None,
    generation_budget: MotifGenerationBudget | None = None,
    motif_tagging_client=None,
) -> str:
    """스크리닝 통과 spec을 무조건 GPT Image로 생성해 pending upsert — motif id 반환.

    카탈로그 재사용 판정은 하지 않는다. 같은 문장 재요청도 새 변형을 만들며,
    (subject, scope)가 같은 모티프가 쌓이는 것은 변형 풀 확충이다 — 품질·중복은
    admin 승인 게이트가 거른다. content-hash upsert라 byte-identical 결과는 행을
    중복시키지 않는다.
    """
    authored_spec = _screen_facets(
        {**spec, "scope": "whole"},
        reject_suspicious=True,
    )
    effective_client = gpt_image_client
    if gpt_image_client is not None and generation_budget is not None:
        effective_client = _BudgetedImageClient(gpt_image_client, generation_budget)
    normalized = await generate_motif(
        authored_spec,
        client=effective_client,
        settings=settings,
        seed=seed,
    )
    facets = facets_from_spec(authored_spec)
    if motif_tagging_client is not None:
        try:
            tagged = await motif_tagging_client.tag(
                normalized.preview_svg,
                subject=authored_spec.get("subject"),
            )
            enriched = _screen_facets(
                {
                    **authored_spec,
                    "description": tagged.description,
                    "tags": tagged.search_tags(),
                    "style": tagged.style,
                },
                reject_suspicious=True,
            )
            facets = facets_from_spec(enriched)
        except (AdapterClientError, TypeError, ValueError):
            logger.warning(
                "motif vision tagging failed — authored metadata retained",
                exc_info=True,
            )
    await store.upsert_motif(
        session,
        normalized,
        facets=facets,
        source="gpt_image",
        ingested_user_id=_provenance_uuid(provenance, "user_id"),
        ingested_session_id=_provenance_uuid(provenance, "session_id"),
    )
    return normalized.id


async def present_candidates(
    session: AsyncSession,
    spec: dict,
    *,
    embedding_client,
    top_k: int,
    tau: float = 0.40,
) -> list[dict]:
    """모티프 시트용 read-only 후보. 이미지는 생성하지 않는다 — `tau`는 벡터 다리 전용."""
    matches = await retrieve_catalog(
        session,
        descriptor_text(spec),
        embedding_client=embedding_client,
        tau=tau,
        top_k=top_k,
    )
    return [_candidate_dict(match.meta, round(match.similarity, 4)) for match in matches]


def _candidate_dict(meta: MotifMeta, similarity: float | None) -> dict:
    return {
        "motif_id": meta.id,
        "similarity": similarity,
        "subject": meta.subject,
        "scope": meta.scope,
        "style": meta.style,
        "description": meta.description,
        "source": meta.source,
    }
