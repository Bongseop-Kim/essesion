"""공개 motif의 누락 Vertex AI embedding을 명시적으로 채운다.

실행:
  uv run python apps/worker/scripts/backfill_motif_embeddings.py --confirm-live
"""

import argparse
import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker
from worker.adapters.embedding import build_embedding_client
from worker.config import get_settings
from worker.db import build_engine
from worker.motifs import store
from worker.motifs.embeddings import backfill_missing_embeddings


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm-live",
        action="store_true",
        help="Vertex AI 과금 호출과 DB 갱신을 명시적으로 승인합니다.",
    )
    return parser.parse_args()


async def _run() -> tuple[int, int, int]:
    settings = get_settings()
    client = build_embedding_client(settings)
    if client is None:
        raise SystemExit("GCP_PROJECT_ID가 없어 Vertex backfill을 실행할 수 없습니다.")
    engine = build_engine(settings)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessionmaker() as session:
            updated = await backfill_missing_embeddings(session, client)
            embedded, total = await store.public_embedding_counts(session)
            return updated, embedded, total
    finally:
        await client.aclose()
        await engine.dispose()


if __name__ == "__main__":
    args = _parse_args()
    if not args.confirm_live:
        raise SystemExit("--confirm-live 없이는 외부 API backfill을 실행하지 않습니다.")
    changed, embedded_count, total_count = asyncio.run(_run())
    print(f"updated {changed} public motif embeddings; embedded={embedded_count}/{total_count}")
