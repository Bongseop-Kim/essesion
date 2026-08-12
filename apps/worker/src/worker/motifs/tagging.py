"""기존 모티프 메타데이터 비전 태깅 서비스."""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from worker.adapters import AdapterClientError
from worker.adapters.motif_tagging import standalone_symbol_svg
from worker.motifs import store
from worker.motifs.resolver import _screen_facets

logger = logging.getLogger(__name__)


async def backfill_missing_tags(session: AsyncSession, client) -> tuple[int, int]:  # noqa: ANN001
    """태깅 성공/실패 수를 반환한다. 성공 행은 즉시 커밋해 재실행이 멱등이다."""
    updated = failed = 0
    for motif in await store.missing_tagging_documents(session):
        try:
            svg = standalone_symbol_svg(motif.symbol, motif.bbox)
            tagged = await client.tag(svg, subject=motif.subject)
            screened = _screen_facets(
                {
                    "description": tagged.description,
                    "tags": tagged.search_tags(),
                    "style": tagged.style,
                },
                reject_suspicious=True,
            )
            updated += int(
                await store.update_tags_if_missing(
                    session,
                    motif.id,
                    description=screened["description"],
                    tags=screened["tags"],
                    style=screened["style"],
                )
            )
            await session.commit()
        except (AdapterClientError, TypeError, ValueError):
            failed += 1
            await session.rollback()
            logger.warning("motif metadata backfill failed for %s", motif.id, exc_info=True)
    return updated, failed
