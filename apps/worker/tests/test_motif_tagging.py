"""기존 Motif 비전 메타데이터 백필 — 실 Postgres + fake 태깅 클라이언트."""

from db.models.seamless import Motif
from worker.adapters.motif_tagging import MotifTaggingResult
from worker.motifs import store
from worker.motifs.embeddings import index_missing_embeddings
from worker.motifs.fingerprint import registry_version_for
from worker.motifs.normalize import NormalizedMotif
from worker.motifs.tagging import backfill_missing_tags


class _Tagging:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    async def tag(self, svg: str, *, subject: str | None) -> MotifTaggingResult:
        self.calls.append((svg, subject))
        return MotifTaggingResult(
            description="푸른 원이 중심에 놓인 플랫 모티프",
            tags_ko=["원", "파랑"],
            tags_en=["circle", "blue"],
            style="flat",
        )


class _Embedding:
    async def embed(self, text: str) -> list[float]:
        assert "푸른 원" in text
        return [0.0, 1.0] + [0.0] * 1534


def _motif(motif_id: str) -> NormalizedMotif:
    return NormalizedMotif(
        id=motif_id,
        symbol=(
            f'<symbol id="motif-{motif_id}" overflow="visible">'
            '<circle cx="0" cy="0" r="0.5" fill="#2244aa"/></symbol>'
        ),
    )


async def test_backfill_tags_public_rows_once_and_skips_user_upload(db_session):
    vector = [1.0] + [0.0] * 1535
    await store.upsert_motif(
        db_session,
        _motif("seed-tagging000001"),
        facets={"subject": "blue circle", "scope": "whole"},
        embedding=vector,
        source="seed",
        status="approved",
    )
    await store.upsert_motif(
        db_session,
        _motif("upload-tagging0001"),
        facets={"subject": "user upload", "scope": "whole"},
        embedding=vector,
        source="user_upload",
        status="approved",
    )
    await db_session.commit()
    fingerprint_before = await registry_version_for(db_session)
    client = _Tagging()

    assert await backfill_missing_tags(db_session, client) == (1, 0)
    assert await backfill_missing_tags(db_session, client) == (0, 0)
    assert len(client.calls) == 1
    assert client.calls[0][0].startswith("<svg")

    public = await db_session.get(Motif, "seed-tagging000001")
    upload = await db_session.get(Motif, "upload-tagging0001")
    assert public is not None and upload is not None
    assert public.description == "푸른 원이 중심에 놓인 플랫 모티프"
    assert public.tags == ["원", "파랑", "circle", "blue"]
    assert public.style == "flat"
    assert public.embedding_openai is None
    assert upload.description is None
    assert upload.embedding_openai is not None
    assert await registry_version_for(db_session) == fingerprint_before

    assert await index_missing_embeddings(db_session, _Embedding()) == 1
    await db_session.refresh(public)
    assert public.embedding_openai is not None
    assert await registry_version_for(db_session) == fingerprint_before
