"""store DB 테스트 — 실제 Postgres(pgvector) (worker-motifs.md §1·§5).

upsert 멱등 · get_motifs JSONB→tuple 변환 · global nearest 안정 정렬 · embedding NULL 제외 ·
공개 embedding backfill.
"""

from worker.motifs import store
from worker.motifs.embeddings import backfill_missing_embeddings
from worker.motifs.normalize import NormalizedMotif
from worker.motifs.registry import MotifDef

DIM = 1536
VERTEX_DIM = 3072


def _vec(*head: float) -> list[float]:
    return list(head) + [0.0] * (DIM - len(head))


def _vertex_vec(*head: float) -> list[float]:
    return list(head) + [0.0] * (VERTEX_DIM - len(head))


def _motif(mid: str, slots: tuple[str, ...] = ("s0",)) -> NormalizedMotif:
    return NormalizedMotif(
        id=mid,
        symbol=f'<symbol id="motif-{mid}" overflow="visible"><circle r="0.5"/></symbol>',
        color_slots=slots,
    )


async def test_upsert_is_idempotent(db_session):
    m = _motif("recraft-aaaaaaaaaaaa")
    await store.upsert_motif(db_session, m, facets={"subject": "dot", "scope": "whole"})
    await store.upsert_motif(db_session, m, facets={"subject": "dot", "scope": "whole"})
    await db_session.commit()
    assert await store.all_motif_ids(db_session) == ["recraft-aaaaaaaaaaaa"]


async def test_get_motifs_converts_jsonb_to_tuples(db_session):
    await store.upsert_motif(
        db_session, _motif("recraft-bbbbbbbbbbbb", ("s0", "s1")), facets={"scope": "whole"}
    )
    await db_session.commit()
    got = await store.get_motifs(db_session, ["recraft-bbbbbbbbbbbb"])
    md = got["recraft-bbbbbbbbbbbb"]
    assert isinstance(md, MotifDef)
    assert md.bbox_mm == (-0.5, -0.5, 0.5, 0.5)
    assert md.anchor == (0.0, 0.0)
    assert md.color_slots == ("s0", "s1")


async def test_get_motifs_empty_ids_returns_empty(db_session):
    assert await store.get_motifs(db_session, []) == {}


async def test_nearest_by_embedding_tie_breaks_on_lowest_id(db_session):
    await store.upsert_motif(
        db_session, _motif("recraft-000000000002"), facets={"scope": "whole"}, embedding=_vec(1.0)
    )
    await store.upsert_motif(
        db_session, _motif("recraft-000000000001"), facets={"scope": "whole"}, embedding=_vec(1.0)
    )
    await db_session.commit()
    matches = await store.nearest_by_embedding(db_session, _vec(1.0), top_k=1)
    assert matches[0].id == "recraft-000000000001"  # 동점 → lowest id
    assert matches[0].similarity == 1.0


async def test_nearest_excludes_null_embedding(db_session):
    await store.upsert_motif(db_session, _motif("recraft-nullembeddin"), facets={"scope": "whole"})
    await store.upsert_motif(
        db_session, _motif("recraft-hasembedding0"), facets={"scope": "whole"}, embedding=_vec(1.0)
    )
    await db_session.commit()
    matches = await store.nearest_by_embedding(db_session, _vec(1.0), top_k=1)
    assert matches[0].id == "recraft-hasembedding0"


async def test_find_by_scope_filters_and_orders(db_session):
    await store.upsert_motif(db_session, _motif("recraft-w2"), facets={"scope": "whole"})
    await store.upsert_motif(db_session, _motif("recraft-w1"), facets={"scope": "whole"})
    await store.upsert_motif(db_session, _motif("recraft-p1"), facets={"scope": "partial"})
    await db_session.commit()
    whole = await store.find_by_scope(db_session, "whole")
    assert [m.id for m in whole] == ["recraft-w1", "recraft-w2"]  # scope 필터 + ORDER BY id


async def test_variant_pool_returns_members_ordered(db_session):
    vg = store.variant_group_key("flower", "whole")
    await store.upsert_motif(
        db_session, _motif("recraft-vg2"), facets={"scope": "whole"}, variant_group=vg
    )
    await store.upsert_motif(
        db_session, _motif("recraft-vg1"), facets={"scope": "whole"}, variant_group=vg
    )
    await db_session.commit()
    pool = await store.find_variant_pool(db_session, vg)
    assert [m.id for m in pool] == ["recraft-vg1", "recraft-vg2"]


async def test_user_upload_is_only_available_by_explicit_id(db_session):
    uploaded = _motif("upload-a1b2c3d4e5f6")
    await store.upsert_motif(
        db_session,
        uploaded,
        facets={"subject": "private", "scope": "whole"},
        embedding=_vec(1.0),
        source=store.USER_UPLOAD_SOURCE,
    )
    await db_session.commit()

    assert (await store.get_motifs(db_session, [uploaded.id]))[uploaded.id].id == uploaded.id
    assert await store.all_motif_ids(db_session) == []
    assert await store.find_by_scope(db_session, "whole") == []
    assert await store.nearest_by_embedding(db_session, _vec(1.0), top_k=1) == []


async def test_global_nearest_does_not_filter_partial_scope(db_session):
    await store.upsert_motif(
        db_session,
        _motif("recraft-partialmatch"),
        facets={"scope": "partial"},
        embedding=_vec(1.0),
    )
    await store.upsert_motif(
        db_session,
        _motif("recraft-wholemiss000"),
        facets={"scope": "whole"},
        embedding=_vec(0.0, 1.0),
    )
    await db_session.commit()

    matches = await store.nearest_by_embedding(db_session, _vec(1.0), top_k=2)
    assert matches[0].id == "recraft-partialmatch"


async def test_embedding_backfill_updates_only_public_null_rows_and_is_idempotent(db_session):
    await store.upsert_motif(
        db_session,
        _motif("recraft-public-null"),
        facets={
            "subject": "chess",
            "scope": "whole",
            "description": "chess king outline",
            "tags": ["king"],
        },
    )
    await store.upsert_motif(
        db_session,
        _motif("recraft-public-done"),
        facets={"subject": "flower", "scope": "whole"},
        embedding=_vertex_vec(0.0, 1.0),
    )
    await store.upsert_motif(
        db_session,
        _motif("upload-private-null"),
        facets={"subject": "private", "scope": "whole"},
        source=store.USER_UPLOAD_SOURCE,
    )
    await db_session.commit()

    class _Embed:
        def __init__(self):
            self.texts: list[str] = []

        async def embed(self, text: str) -> list[float]:
            self.texts.append(text)
            return _vertex_vec(1.0)

    client = _Embed()
    assert await backfill_missing_embeddings(db_session, client) == 1
    assert client.texts == ["chess, chess king outline, king"]
    assert await store.public_embedding_counts(db_session) == (2, 2)
    assert await backfill_missing_embeddings(db_session, client) == 0
    assert client.texts == ["chess, chess king outline, king"]
