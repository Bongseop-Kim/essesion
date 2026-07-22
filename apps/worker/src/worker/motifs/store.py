"""모티프 영속 계층 — async SQLAlchemy over `motifs` (pgvector) (worker-motifs.md §1·§5).

프로세스-로컬 in-memory 레지스트리는 두지 않는다(ARCHITECTURE §7): 요청 세션이 진실의
원천이고, content-hash PK + ON CONFLICT DO NOTHING이 곧 멱등성이다. 검색·저장 양쪽에서
facet 정규화(NFC+strip+casefold)를 동일하게 적용한다.
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, cast

from db.models.seamless import EMBEDDING_DIM, LEGACY_EMBEDDING_DIM, Motif
from pgvector.sqlalchemy import HALFVEC
from sqlalchemy import CursorResult, func, select, update
from sqlalchemy import cast as sql_cast
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from worker.motifs.normalize import NormalizedMotif
from worker.motifs.registry import BBox, MotifDef

# scope는 저장 facet의 통제 어휘다. 공개 검색은 scope로 제한하지 않는다.
SCOPE_VOCAB: frozenset[str] = frozenset({"whole", "partial"})
VARIANT_GROUP_VERSION = 2
VARIANT_GROUP_LEN = 16

_EXACT_FACETS = ("subject", "scope", "view", "expression", "style", "description")
USER_UPLOAD_SOURCE = "user_upload"


def normalize_facet(value: str | None) -> str:
    """해싱·비교용 정규 형태: NFC → strip → casefold. None/공백은 ""."""
    if value is None:
        return ""
    return unicodedata.normalize("NFC", value).strip().casefold()


def embedding_document(
    *,
    subject: str | None = None,
    description: str | None = None,
    style: str | None = None,
    view: str | None = None,
    expression: str | None = None,
    tags: Iterable[str] = (),
) -> str:
    """검색·backfill이 공유하는 임베딩 문서. scope는 의미 검색에서 제외한다."""
    segments = [subject, description, style, view, expression, *tags]
    return ", ".join(value.strip() for value in segments if value and value.strip())


def validate_facets(scope: str | None) -> None:
    """유일한 통제 facet scope 검증 — 어휘 밖이면 ValueError. None/subject는 통과."""
    allowed = {normalize_facet(s) for s in SCOPE_VOCAB}
    if scope is not None and normalize_facet(scope) not in allowed:
        raise ValueError(f"scope {scope!r} not in controlled vocabulary: {sorted(SCOPE_VOCAB)}")


def variant_group_key(subject: str | None, scope: str | None) -> str:
    """(subject, scope) 풀 키 = sha256_hex(canonical({v, subject, scope}))[:16] (§5.6)."""
    payload = {
        "v": VARIANT_GROUP_VERSION,
        "subject": normalize_facet(subject),
        "scope": normalize_facet(scope),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:VARIANT_GROUP_LEN]


@dataclass(frozen=True)
class MotifMeta:
    """symbol/embedding 없는 공개 검색 후보."""

    id: str
    variant_group: str | None
    subject: str | None
    scope: str | None
    view: str | None
    expression: str | None
    style: str | None
    description: str | None
    tags: tuple[str, ...] = ()
    source: str | None = None


@dataclass(frozen=True)
class MotifMatch:
    """임베딩 코사인 최근접 결과."""

    id: str
    variant_group: str | None
    similarity: float


@dataclass(frozen=True)
class MotifEmbeddingDocument:
    id: str
    subject: str | None
    description: str | None
    style: str | None
    view: str | None
    expression: str | None
    tags: tuple[str, ...]


@dataclass(frozen=True)
class PoolMember:
    """variant pool 멤버 — τ 스코핑에 embedding 필요."""

    id: str
    embedding: list[float] | None


def _bbox_tuple(value: object) -> BBox:
    seq = list(value) if isinstance(value, (list, tuple)) else [-0.5, -0.5, 0.5, 0.5]
    return (float(seq[0]), float(seq[1]), float(seq[2]), float(seq[3]))


def _anchor_tuple(value: object) -> tuple[float, float]:
    seq = list(value) if isinstance(value, (list, tuple)) else [0.0, 0.0]
    return (float(seq[0]), float(seq[1]))


async def upsert_motif(
    session: AsyncSession,
    normalized: NormalizedMotif,
    *,
    facets: dict,
    embedding: list[float] | None = None,
    source: str = "recraft",
    variant_group: str | None = None,
) -> str:
    """정규화 모티프를 content-hash id로 멱등 저장 (ON CONFLICT DO NOTHING) → id 반환.

    scope는 정규화해 저장(하드 필터가 정규 형태로 비교). commit은 호출자(라우트/시드) 소관.
    """
    scope = normalize_facet(facets.get("scope")) or None
    values = {
        "id": normalized.id,
        "symbol": normalized.symbol,
        "color_slots": list(normalized.color_slots),
        "bbox": list(normalized.bbox_mm),
        "anchor": list(normalized.anchor),
        "subject": facets.get("subject"),
        "scope": scope,
        "view": facets.get("view"),
        "expression": facets.get("expression"),
        "style": facets.get("style"),
        "description": facets.get("description"),
        "tags": list(facets.get("tags") or []),
        "source": source,
        "variant_group": variant_group,
        "embedding_vertex": (
            embedding if embedding is None or len(embedding) != LEGACY_EMBEDDING_DIM else None
        ),
        "embedding": (
            embedding if embedding is not None and len(embedding) == LEGACY_EMBEDDING_DIM else None
        ),
    }
    stmt = pg_insert(Motif).values(**values).on_conflict_do_nothing(index_elements=["id"])
    await session.execute(stmt)
    return normalized.id


async def get_motifs(session: AsyncSession, ids: Iterable[str]) -> dict[str, MotifDef]:
    """id 집합 → {id: MotifDef}. JSONB bbox/anchor를 tuple로 되돌리는 소유 지점."""
    id_list = list(dict.fromkeys(ids))
    if not id_list:
        return {}
    rows = (await session.scalars(select(Motif).where(Motif.id.in_(id_list)))).all()
    return {
        row.id: MotifDef(
            id=row.id,
            symbol=row.symbol,
            bbox_mm=_bbox_tuple(row.bbox),
            anchor=_anchor_tuple(row.anchor),
            color_slots=tuple(row.color_slots or ("s0",)),
        )
        for row in rows
    }


async def find_by_scope(session: AsyncSession, scope: str) -> list[MotifMeta]:
    """레거시 scope별 조회. 자동 공개 카탈로그 검색에는 사용하지 않는다."""
    norm = normalize_facet(scope)
    rows = (
        await session.execute(
            select(
                Motif.id,
                Motif.variant_group,
                Motif.subject,
                Motif.scope,
                Motif.view,
                Motif.expression,
                Motif.style,
                Motif.description,
                Motif.tags,
                Motif.source,
            )
            .where(Motif.scope == norm, Motif.source != USER_UPLOAD_SOURCE)
            .order_by(Motif.id)
        )
    ).all()
    return [
        MotifMeta(
            id=row[0],
            variant_group=row[1],
            subject=row[2],
            scope=row[3],
            view=row[4],
            expression=row[5],
            style=row[6],
            description=row[7],
            tags=tuple(row[8] or ()),
            source=row[9],
        )
        for row in rows
    ]


async def find_catalog(session: AsyncSession) -> list[MotifMeta]:
    """공개 카탈로그 전체를 ID 순으로 반환한다. scope는 검색 필터가 아니다."""
    rows = (
        await session.execute(
            select(
                Motif.id,
                Motif.variant_group,
                Motif.subject,
                Motif.scope,
                Motif.view,
                Motif.expression,
                Motif.style,
                Motif.description,
                Motif.tags,
                Motif.source,
            )
            .where(Motif.source != USER_UPLOAD_SOURCE)
            .order_by(Motif.id)
        )
    ).all()
    return [
        MotifMeta(
            id=row[0],
            variant_group=row[1],
            subject=row[2],
            scope=row[3],
            view=row[4],
            expression=row[5],
            style=row[6],
            description=row[7],
            tags=tuple(row[8] or ()),
            source=row[9],
        )
        for row in rows
    ]


async def nearest_by_embedding(
    session: AsyncSession, vec: list[float], *, top_k: int = 1
) -> list[MotifMatch]:
    """공개 카탈로그 코사인 최근접 top-k. 동점은 lowest ID, NULL은 제외한다."""
    legacy = len(vec) == LEGACY_EMBEDDING_DIM
    column = Motif.embedding if legacy else Motif.embedding_vertex
    distance_column = column if legacy else sql_cast(column, HALFVEC(EMBEDDING_DIM))
    distance = distance_column.cosine_distance(vec)
    rows = (
        await session.execute(
            select(Motif.id, Motif.variant_group, distance.label("distance"))
            .where(
                column.is_not(None),
                Motif.source != USER_UPLOAD_SOURCE,
            )
            .order_by(distance.asc(), Motif.id.asc())
            .limit(top_k)
        )
    ).all()
    return [
        MotifMatch(id=row[0], variant_group=row[1], similarity=1.0 - float(row[2])) for row in rows
    ]


async def missing_embedding_documents(session: AsyncSession) -> list[MotifEmbeddingDocument]:
    """backfill 대상 공개 모티프를 안정 순서로 읽는다."""
    rows = (
        await session.execute(
            select(
                Motif.id,
                Motif.subject,
                Motif.description,
                Motif.style,
                Motif.view,
                Motif.expression,
                Motif.tags,
            )
            .where(Motif.source != USER_UPLOAD_SOURCE, Motif.embedding_vertex.is_(None))
            .order_by(Motif.id)
        )
    ).all()
    return [
        MotifEmbeddingDocument(
            id=row[0],
            subject=row[1],
            description=row[2],
            style=row[3],
            view=row[4],
            expression=row[5],
            tags=tuple(row[6] or ()),
        )
        for row in rows
    ]


async def update_embedding_if_missing(
    session: AsyncSession, motif_id: str, embedding: list[float]
) -> bool:
    """공개 NULL 행만 갱신한다. 재실행과 동시 backfill 모두 멱등이다."""
    result = await session.execute(
        update(Motif)
        .where(
            Motif.id == motif_id,
            Motif.source != USER_UPLOAD_SOURCE,
            Motif.embedding_vertex.is_(None),
        )
        .values(embedding_vertex=embedding)
    )
    return bool(cast("CursorResult[Any]", result).rowcount)


async def public_embedding_counts(session: AsyncSession) -> tuple[int, int]:
    """(embedded, total) 공개 카탈로그 적재 상태."""
    embedded, total = (
        await session.execute(
            select(
                func.count().filter(Motif.embedding_vertex.is_not(None)),
                func.count(),
            ).where(Motif.source != USER_UPLOAD_SOURCE)
        )
    ).one()
    return int(embedded), int(total)


async def find_variant_pool(session: AsyncSession, variant_group: str) -> list[PoolMember]:
    """variant_group 샘플링 풀(id + embedding), ORDER BY id. 빈 리스트면 풀 없음."""
    rows = (
        await session.execute(
            select(Motif.id, Motif.embedding_vertex)
            .where(
                Motif.variant_group == variant_group,
                Motif.source != USER_UPLOAD_SOURCE,
            )
            .order_by(Motif.id)
        )
    ).all()
    return [
        PoolMember(id=row[0], embedding=list(row[1]) if row[1] is not None else None)
        for row in rows
    ]


async def all_motif_ids(session: AsyncSession) -> list[str]:
    """전체 모티프 id, ORDER BY id — fingerprint용 경량 스캔."""
    return list(
        (
            await session.scalars(
                select(Motif.id).where(Motif.source != USER_UPLOAD_SOURCE).order_by(Motif.id)
            )
        ).all()
    )


def exact_facet_key(spec_or_meta: dict | MotifMeta) -> tuple[str, ...]:
    """exact-descriptor 비교 키 — 6개 facet 정규 형태 튜플."""
    if isinstance(spec_or_meta, MotifMeta):
        get = lambda k: getattr(spec_or_meta, k)  # noqa: E731
    else:
        get = spec_or_meta.get
    return tuple(normalize_facet(get(k)) for k in _EXACT_FACETS)


def facets_from_spec(spec: dict) -> dict:
    """spec dict → upsert용 facet dict (subject/scope 정규화, 나머지는 원문)."""
    return {
        "subject": normalize_facet(spec.get("subject")) or None,
        "scope": normalize_facet(spec.get("scope")) or None,
        "view": spec.get("view"),
        "expression": spec.get("expression"),
        "style": spec.get("style"),
        "description": spec.get("description"),
        "tags": spec.get("tags") or [],
    }
