"""공개 모티프의 초기 embedding 인덱스 구성 서비스."""

from db.models.seamless import EMBEDDING_DIM
from sqlalchemy.ext.asyncio import AsyncSession

from worker.motifs import store

# /embeddings 배열 입력 한 번에 보낼 문서 수 — 1건당 1 HTTP 왕복 제거
# (perf-cost-reduction 리뷰 14번).
_BATCH_SIZE = 64


async def index_missing_embeddings(session: AsyncSession, client) -> int:  # noqa: ANN001
    """NULL 공개 행을 인덱싱하고 갱신 수를 반환한다. user_upload은 제외한다."""
    updated = 0
    motifs = await store.missing_embedding_documents(session)
    for start in range(0, len(motifs), _BATCH_SIZE):
        batch = motifs[start : start + _BATCH_SIZE]
        texts = [
            store.embedding_document(
                subject=motif.subject,
                description=motif.description,
                style=motif.style,
                tags=motif.tags,
            )
            for motif in batch
        ]
        embeddings = await client.embed_batch(texts)
        for motif, embedding in zip(batch, embeddings, strict=True):
            if len(embedding) != EMBEDDING_DIM:
                raise ValueError(
                    f"embedding dimension mismatch for {motif.id}: "
                    f"expected {EMBEDDING_DIM}, got {len(embedding)}"
                )
            updated += int(await store.update_embedding_if_missing(session, motif.id, embedding))
        # 배치 단위 커밋 — 중간 실패 시 이미 인덱싱된 배치는 보존돼 재실행이 멱등이다.
        await session.commit()
    return updated
