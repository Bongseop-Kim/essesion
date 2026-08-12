"""설명이 없는 공개 계열 motif의 비전 메타데이터를 채운다.

실행:
  uv run python apps/worker/scripts/backfill_motif_tags.py --confirm-live
"""

import argparse
import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker
from worker.adapters.motif_tagging import build_motif_tagging_client
from worker.config import get_settings
from worker.db import build_engine
from worker.motifs.tagging import backfill_missing_tags


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm-live",
        action="store_true",
        help="OpenAI 비전 과금 호출과 DB 갱신을 명시적으로 승인합니다.",
    )
    return parser.parse_args()


async def _run() -> tuple[int, int]:
    settings = get_settings()
    client = build_motif_tagging_client(settings)
    if client is None:
        raise SystemExit("OPENAI_API_KEY가 없어 Motif 태깅을 실행할 수 없습니다.")
    engine = build_engine(settings)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessionmaker() as session:
            return await backfill_missing_tags(session, client)
    finally:
        await client.aclose()
        await engine.dispose()


if __name__ == "__main__":
    args = _parse_args()
    if not args.confirm_live:
        raise SystemExit("--confirm-live 없이는 외부 API 태깅을 실행하지 않습니다.")
    updated_count, failed_count = asyncio.run(_run())
    print(f"updated {updated_count} motif metadata rows; failed={failed_count}")
