"""공개 모티프 embedding backfill 서비스."""

from db.models.seamless import EMBEDDING_DIM
from sqlalchemy.ext.asyncio import AsyncSession

from worker.motifs import store


async def backfill_missing_embeddings(session: AsyncSession, client) -> int:  # noqa: ANN001
    """NULL 공개 행만 채우고 갱신 수를 반환한다. user_upload은 store에서 제외한다."""
    updated = 0
    for motif in await store.missing_embedding_documents(session):
        text = store.embedding_document(
            subject=motif.subject,
            description=motif.description,
            style=motif.style,
            view=motif.view,
            expression=motif.expression,
            tags=motif.tags,
        )
        try:
            embedding = await client.embed(text, task_type="RETRIEVAL_DOCUMENT")
        except TypeError as exc:
            if "task_type" not in str(exc):
                raise
            embedding = await client.embed(text)
        if len(embedding) != EMBEDDING_DIM:
            raise ValueError(
                f"embedding dimension mismatch for {motif.id}: "
                f"expected {EMBEDDING_DIM}, got {len(embedding)}"
            )
        updated += int(await store.update_embedding_if_missing(session, motif.id, embedding))
        await session.commit()
    return updated
