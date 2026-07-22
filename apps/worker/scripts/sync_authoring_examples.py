"""Project gallery-v1 Plan v3 examples and create their Vertex embeddings.

Usage:
  uv run python apps/worker/scripts/sync_authoring_examples.py --confirm-live
"""

import argparse
import asyncio

from db.models.seamless import EMBEDDING_DIM
from sqlalchemy.ext.asyncio import async_sessionmaker
from worker.adapters.embedding import build_embedding_client
from worker.authoring import store
from worker.authoring.examples import load_example_set
from worker.config import get_settings
from worker.db import build_engine


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm-live",
        action="store_true",
        help="Vertex embedding 과금 호출과 DB 갱신에 동의합니다.",
    )
    return parser.parse_args()


async def _run() -> tuple[int, int, int, int]:
    settings = get_settings()
    client = build_embedding_client(settings)
    if client is None:
        raise SystemExit("GCP_PROJECT_ID가 없어 예시 임베딩을 생성할 수 없습니다.")
    examples = load_example_set()
    engine = build_engine(settings)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    inserted = 0
    embedded_now = 0
    try:
        async with sessionmaker() as session:
            for example in examples:
                inserted += int(
                    await store.project_manifest(
                        session,
                        example,
                        embedding_model=client.model,
                    )
                )
            await session.commit()

            missing = await store.missing_embedding_ids(
                session,
                embedding_model=client.model,
            )
            for example in examples:
                if example.example_id not in missing:
                    continue
                embedding = await client.embed(
                    example.embedding_document(), task_type="RETRIEVAL_DOCUMENT"
                )
                if len(embedding) != EMBEDDING_DIM:
                    raise ValueError(
                        f"embedding dimension mismatch for {example.example_id}: "
                        f"expected {EMBEDDING_DIM}, got {len(embedding)}"
                    )
                embedded_now += int(
                    await store.update_embedding_if_missing(
                        session,
                        example_id=example.example_id,
                        embedding_model=client.model,
                        embedding=embedding,
                    )
                )
                await session.commit()
            embedded, total = await store.embedding_counts(
                session,
                embedding_model=client.model,
            )
            return inserted, embedded_now, embedded, total
    finally:
        await client.aclose()
        await engine.dispose()


if __name__ == "__main__":
    args = _arguments()
    if not args.confirm_live:
        raise SystemExit("--confirm-live 없이는 외부 API 호출과 DB 갱신을 실행하지 않습니다.")
    inserted_count, updated_count, embedded_count, total_count = asyncio.run(_run())
    print(
        f"projected {inserted_count} examples; embedded {updated_count}; "
        f"embedded={embedded_count}/{total_count} source=bootstrap"
    )
