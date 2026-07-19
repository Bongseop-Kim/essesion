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

from db.models.seamless import Motif
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from worker.motifs.normalize import NormalizedMotif
from worker.motifs.registry import BBox, MotifDef

# 통제 어휘(D10): scope(granularity)만 하드 필터. subject는 자유 텍스트 — 의미 구분은 임베딩 몫.
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
    """symbol/embedding 없는 검색 후보 — exact match·lowest-id 폴백이 읽는 facet+id."""

    id: str
    variant_group: str | None
    subject: str | None
    scope: str | None
    view: str | None
    expression: str | None
    style: str | None
    description: str | None
    source: str | None = None


@dataclass(frozen=True)
class MotifMatch:
    """임베딩 코사인 최근접 1건 (id + group + similarity)."""

    id: str
    variant_group: str | None
    similarity: float


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
        "embedding": embedding,
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
    """scope 하드 필터 후보(facet+id만), ORDER BY id — 안정 정렬."""
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
                Motif.source,
            )
            .where(Motif.scope == norm, Motif.source != USER_UPLOAD_SOURCE)
            .order_by(Motif.id)
        )
    ).all()
    return [MotifMeta(*row) for row in rows]


async def nearest_by_embedding(
    session: AsyncSession, vec: list[float], *, scope: str
) -> MotifMatch | None:
    """scope 내 코사인 최근접 1건(동점 lowest-id). embedding NULL 제외. 없으면 None."""
    norm = normalize_facet(scope)
    distance = Motif.embedding.cosine_distance(vec)
    row = (
        await session.execute(
            select(Motif.id, Motif.variant_group, distance.label("distance"))
            .where(
                Motif.scope == norm,
                Motif.embedding.is_not(None),
                Motif.source != USER_UPLOAD_SOURCE,
            )
            .order_by(distance.asc(), Motif.id.asc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    return MotifMatch(id=row[0], variant_group=row[1], similarity=1.0 - float(row[2]))


async def find_variant_pool(session: AsyncSession, variant_group: str) -> list[PoolMember]:
    """variant_group 샘플링 풀(id + embedding), ORDER BY id. 빈 리스트면 풀 없음."""
    rows = (
        await session.execute(
            select(Motif.id, Motif.embedding)
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
