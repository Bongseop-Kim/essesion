"""모티프 영속 계층 — async SQLAlchemy over `motifs` (pgvector) (worker-motifs.md §1·§5).

프로세스-로컬 in-memory 레지스트리는 두지 않는다(ARCHITECTURE §7): 요청 세션이 진실의
원천이고, content-hash PK + ON CONFLICT DO NOTHING이 곧 멱등성이다. 검색·저장 양쪽에서
facet 정규화(NFC+strip+casefold)를 동일하게 적용한다.
"""

from __future__ import annotations

import json
import unicodedata
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, cast

from db.models.seamless import EMBEDDING_DIM, Motif
from pgvector.sqlalchemy import HALFVEC
from sqlalchemy import CursorResult, func, select, update
from sqlalchemy import cast as sql_cast
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from worker.engine.determinism import stable_digest
from worker.motifs.normalize import NormalizedMotif
from worker.motifs.registry import BBox, MotifDef

VARIANT_GROUP_VERSION = 2
VARIANT_GROUP_LEN = 16

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
    """검색·초기 인덱싱이 공유하는 임베딩 문서. scope는 의미 검색에서 제외한다."""
    segments = [subject, description, style, view, expression, *tags]
    return ", ".join(value.strip() for value in segments if value and value.strip())


def variant_group_key(subject: str | None, scope: str | None) -> str:
    """(subject, scope) 풀 키 = sha256_hex(canonical({v, subject, scope}))[:16] (§5.6)."""
    payload = {
        "v": VARIANT_GROUP_VERSION,
        "subject": normalize_facet(subject),
        "scope": normalize_facet(scope),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return stable_digest(canonical, VARIANT_GROUP_LEN)


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


@dataclass(frozen=True)
class MotifUpsertResult:
    id: str
    inserted: bool


@dataclass(frozen=True)
class SlotLabelBackfillRow:
    id: str
    symbol: str
    slot_colors: tuple[str, ...]


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
    slot_labels: tuple[str, ...] | None = None,
    ingested_user_id: uuid.UUID | None = None,
    ingested_session_id: uuid.UUID | None = None,
) -> MotifUpsertResult:
    """정규화 모티프를 content-hash id로 멱등 저장하고 실제 신규 insert 여부를 반환.

    scope는 정규화해 저장(하드 필터가 정규 형태로 비교). commit은 호출자(라우트/시드) 소관.
    기존 geometry/facet/provenance는 절대 덮지 않는다. 라벨만 NULL 행에 한해 후속 ingress
    라벨링 결과로 채울 수 있다.
    """
    scope = normalize_facet(facets.get("scope")) or None
    if embedding is not None and len(embedding) != EMBEDDING_DIM:
        raise ValueError(f"embedding dimension must be {EMBEDDING_DIM}, got {len(embedding)}")
    if slot_labels is not None and len(slot_labels) != len(normalized.color_slots):
        raise ValueError("slot_labels must be index-aligned with color_slots")

    values = {
        "id": normalized.id,
        "symbol": normalized.symbol,
        "color_slots": list(normalized.color_slots),
        "slot_colors": list(normalized.slot_colors) if normalized.slot_colors else None,
        "slot_labels": list(slot_labels) if slot_labels else None,
        "ingested_user_id": ingested_user_id,
        "ingested_session_id": ingested_session_id,
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
        "embedding_vertex": embedding,
    }
    stmt = (
        pg_insert(Motif)
        .values(**values)
        .on_conflict_do_nothing(index_elements=["id"])
        .returning(Motif.id)
    )
    inserted_id = (await session.execute(stmt)).scalar_one_or_none()
    if inserted_id is None and slot_labels is not None:
        await session.execute(
            update(Motif)
            .where(Motif.id == normalized.id, Motif.slot_labels.is_(None))
            .values(slot_labels=list(slot_labels))
        )
    return MotifUpsertResult(id=normalized.id, inserted=inserted_id is not None)


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
            slot_colors=tuple(row.slot_colors) if row.slot_colors else None,
            slot_labels=tuple(row.slot_labels) if row.slot_labels else None,
        )
        for row in rows
    }


async def missing_slot_label_rows(session: AsyncSession) -> list[SlotLabelBackfillRow]:
    """라벨링 가능한 공개 멀티슬롯 NULL 행을 content-hash 순서로 읽는다."""

    rows = (
        await session.execute(
            select(Motif.id, Motif.symbol, Motif.slot_colors)
            .where(
                Motif.source != USER_UPLOAD_SOURCE,
                Motif.slot_labels.is_(None),
                Motif.slot_colors.is_not(None),
                func.jsonb_array_length(Motif.color_slots) > 1,
            )
            .order_by(Motif.id)
        )
    ).all()
    return [
        SlotLabelBackfillRow(
            id=row[0],
            symbol=row[1],
            slot_colors=tuple(row[2]),
        )
        for row in rows
    ]


async def update_slot_labels_if_missing(
    session: AsyncSession,
    motif_id: str,
    slot_labels: tuple[str, ...],
) -> bool:
    """NULL 라벨만 채운다. 재실행과 동시 백필 모두 멱등이다."""

    result = await session.execute(
        update(Motif)
        .where(
            Motif.id == motif_id,
            Motif.source != USER_UPLOAD_SOURCE,
            Motif.slot_labels.is_(None),
            func.jsonb_array_length(Motif.color_slots) == len(slot_labels),
        )
        .values(slot_labels=list(slot_labels))
    )
    return bool(cast("CursorResult[Any]", result).rowcount)


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
    if len(vec) != EMBEDDING_DIM:
        raise ValueError(f"embedding dimension must be {EMBEDDING_DIM}, got {len(vec)}")
    column = Motif.embedding_vertex
    distance_column = sql_cast(column, HALFVEC(EMBEDDING_DIM))
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
    """인덱싱되지 않은 공개 모티프를 안정 순서로 읽는다."""
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
    """공개 NULL 행만 갱신한다. 재실행과 동시 인덱싱 모두 멱등이다."""
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
