"""모티프 영속 계층 — async SQLAlchemy over `motifs` (worker-motifs.md §1).

프로세스-로컬 in-memory 레지스트리는 두지 않는다(ARCHITECTURE §6): 요청 세션이 진실의
원천이고, content-hash PK + ON CONFLICT DO NOTHING이 곧 멱등성이다.
"""

from __future__ import annotations

import unicodedata
import uuid
from collections.abc import Iterable
from typing import cast

from db.models.design import (
    DesignSession,
    DesignSessionTurn,
    DesignTurnAttachment,
    UserMotif,
)
from db.models.seamless import Motif
from sqlalchemy import CursorResult, Text, delete, exists, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from worker.motifs.normalize import NormalizedMotif
from worker.motifs.registry import BBox, MotifDef

USER_UPLOAD_SOURCE = "user_upload"
APPROVED_STATUS = "approved"


def normalize_facet(value: str | None) -> str:
    """해싱·비교용 정규 형태: NFC → strip → casefold. None/공백은 ""."""
    if value is None:
        return ""
    return unicodedata.normalize("NFC", value).strip().casefold()


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
    source: str,
    status: str = "pending",
    ingested_user_id: uuid.UUID | None = None,
    ingested_session_id: uuid.UUID | None = None,
) -> None:
    """정규화 모티프를 content-hash id로 멱등 저장한다(id는 호출자가 이미 갖고 있다).

    scope는 정규화해 저장(하드 필터가 정규 형태로 비교). commit은 호출자(라우트/시드) 소관.
    생성 모티프 기본 상태는 pending이고 신뢰된 시드만 approved를 명시한다. 기존
    geometry/facet/provenance/status는 절대 덮지 않는다.
    """
    scope = normalize_facet(facets.get("scope")) or None
    values = {
        "id": normalized.id,
        "symbol": normalized.symbol,
        "ingested_user_id": ingested_user_id,
        "ingested_session_id": ingested_session_id,
        "bbox": list(normalized.bbox_mm),
        "anchor": list(normalized.anchor),
        "subject": facets.get("subject"),
        "scope": scope,
        "style": facets.get("style"),
        "description": facets.get("description"),
        "tags": list(facets.get("tags") or []),
        "source": source,
        "status": status,
    }
    await session.execute(
        pg_insert(Motif).values(**values).on_conflict_do_nothing(index_elements=["id"])
    )


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
        )
        for row in rows
    }


async def approved_motif_ids(session: AsyncSession) -> list[str]:
    """승인된 공개 모티프 id, ORDER BY id — fingerprint용 경량 스캔."""
    return list(
        (
            await session.scalars(
                select(Motif.id)
                .where(
                    Motif.source != USER_UPLOAD_SOURCE,
                    Motif.status == APPROVED_STATUS,
                )
                .order_by(Motif.id)
            )
        ).all()
    )


async def prune_stale_seeds(session: AsyncSession, seeded_ids: Iterable[str]) -> int:
    """현재 시드 집합에 없는 `source="seed"` 고아 행을 지운다 — 삭제된 행 수 반환.

    에셋 SVG를 고치면 content-hash id가 바뀌고 upsert는 ON CONFLICT DO NOTHING이라
    옛 행이 남는다. 방치하면 admin 카탈로그에 옛 geometry가 계속 노출된다.
    참조된 행은 남긴다 — 과거 세션 intent가 가리키는 모티프는 불변이어야 한다.

    참조는 FK(user_motifs·design_turn_attachments) **와 JSON 본문** 양쪽을 본다. 세션의
    resolved intent·plan과 턴 이력 payload는 motif id를 FK 없이 문자열로 들고 있어서,
    FK만 보면 살아 있는 세션이 가리키는 행을 조용히 지운다(2026-08-17에 로컬에서 실제로
    밟았다 — `docs/reviews/motif-search-derag-2026-08-17.md`). JSON은 `::text` 부분일치로
    훑는다: 오탐은 행을 살려두는 안전한 방향이고, id가 어디에 중첩돼 있든 놓치지 않는다.
    """
    ids = list(seeded_ids)
    # 빈 집합이면 아무것도 지우지 않는다 — 빈 notin_은 항상 참이라 시드 전체를 지워버린다.
    if not ids:
        return 0
    result = cast(
        CursorResult,
        await session.execute(
            delete(Motif).where(
                Motif.source == "seed",
                Motif.id.notin_(ids),
                ~exists().where(UserMotif.motif_id == Motif.id),
                ~exists().where(DesignTurnAttachment.motif_id == Motif.id),
                ~exists().where(
                    or_(
                        DesignSession.current_intent.cast(Text).contains(Motif.id),
                        DesignSession.current_plan.cast(Text).contains(Motif.id),
                    )
                ),
                ~exists().where(DesignSessionTurn.payload.cast(Text).contains(Motif.id)),
            )
        ),
    )
    return result.rowcount
