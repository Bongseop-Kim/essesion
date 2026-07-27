"""공개 멀티슬롯 motif의 NULL slot labels/parts를 백필한다.

실행:
  uv run python apps/worker/scripts/backfill_slot_labels.py --confirm-live
"""

import argparse
import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker
from worker.adapters.gemini import build_gemini_client
from worker.config import get_settings
from worker.db import build_engine
from worker.motifs import store
from worker.motifs.labeler import label_slots, stored_motif_preview_svg


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm-live",
        action="store_true",
        help="Vertex AI 비전 과금 호출과 DB 갱신을 명시적으로 승인합니다.",
    )
    return parser.parse_args()


async def backfill_slot_labels(session, client, settings) -> tuple[int, int]:  # noqa: ANN001
    """Return ``(eligible, updated)``; concurrent/repeated runs update NULL rows only."""

    rows = await store.missing_slot_metadata_rows(session)
    updated = 0
    for row in rows:
        preview = stored_motif_preview_svg(row.id, row.symbol, row.slot_colors)
        metadata = await label_slots(
            preview,
            row.slot_colors,
            gemini_client=client,
            settings=settings,
        )
        if metadata is None:
            continue
        updated += int(
            await store.update_slot_metadata_if_missing(
                session,
                row.id,
                slot_labels=metadata.labels,
                slot_parts=metadata.parts,
            )
        )
        await session.commit()
    return len(rows), updated


async def _run() -> tuple[int, int]:
    settings = get_settings()
    client = build_gemini_client(settings)
    if client is None:
        raise SystemExit("GCP_PROJECT_ID가 없어 슬롯 라벨 백필을 실행할 수 없습니다.")
    engine = build_engine(settings)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessionmaker() as session:
            return await backfill_slot_labels(session, client, settings)
    finally:
        await client.aclose()
        await engine.dispose()


if __name__ == "__main__":
    args = _parse_args()
    if not args.confirm_live:
        raise SystemExit("--confirm-live 없이는 외부 API 라벨 백필을 실행하지 않습니다.")
    eligible_count, updated_count = asyncio.run(_run())
    print(f"eligible={eligible_count}; updated={updated_count} public motif slot metadata rows")
