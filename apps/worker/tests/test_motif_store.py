"""store DB 테스트 — 실제 Postgres(pgvector) (worker-motifs.md §1·§5).

upsert 멱등 · get_motifs JSONB→tuple 변환 · global nearest 안정 정렬 · embedding NULL 제외 ·
공개 embedding 초기 인덱싱.
"""

import pytest
from db.models.design import UserMotif
from db.models.seamless import Motif
from sqlalchemy import select, text
from worker.motifs import store
from worker.motifs.embeddings import index_missing_embeddings
from worker.motifs.normalize import NormalizedMotif
from worker.motifs.registry import MotifDef

DIM = 3072


def _vec(*head: float) -> list[float]:
    return list(head) + [0.0] * (DIM - len(head))


def _motif(mid: str, slots: tuple[str, ...] = ("s0",)) -> NormalizedMotif:
    return NormalizedMotif(
        id=mid,
        symbol=f'<symbol id="motif-{mid}" overflow="visible"><circle r="0.5"/></symbol>',
        color_slots=slots,
    )


async def test_upsert_is_idempotent(db_session):
    m = _motif("recraft-aaaaaaaaaaaa")
    first = await store.upsert_motif(db_session, m, facets={"subject": "dot", "scope": "whole"})
    second = await store.upsert_motif(db_session, m, facets={"subject": "dot", "scope": "whole"})
    await db_session.commit()
    assert first == store.MotifUpsertResult(id=m.id, inserted=True)
    assert second == store.MotifUpsertResult(id=m.id, inserted=False)
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


async def test_upsert_persists_slot_colors_and_nulls_single_slot(db_session):
    multi = NormalizedMotif(
        id="recraft-slotcolors0",
        symbol='<symbol id="motif-recraft-slotcolors0"><path fill="s0"/><path fill="s1"/></symbol>',
        color_slots=("s0", "s1"),
        slot_colors=("#010000", "#0685b1"),
    )
    await store.upsert_motif(db_session, multi, facets={"scope": "whole"})
    await store.upsert_motif(db_session, _motif("recraft-singleslot0"), facets={"scope": "whole"})
    await db_session.commit()
    rows = {row.id: row.slot_colors for row in (await db_session.scalars(select(Motif))).all()}
    assert rows["recraft-slotcolors0"] == ["#010000", "#0685b1"]
    # Single-slot → SQL NULL (none_as_null), not JSON null.
    assert rows["recraft-singleslot0"] is None


async def test_slot_metadata_is_optional_index_aligned_and_not_identity(db_session):
    multi = NormalizedMotif(
        id="recraft-slotlabels0",
        symbol='<symbol id="motif-recraft-slotlabels0"><path fill="s0"/><path fill="s1"/></symbol>',
        color_slots=("s0", "s1"),
        slot_colors=("#010000", "#0685B1"),
    )
    first = await store.upsert_motif(
        db_session,
        multi,
        facets={"scope": "whole"},
    )
    labeled = await store.upsert_motif(
        db_session,
        multi,
        facets={"scope": "whole"},
        slot_labels=("outline", "primary"),
    )
    parted = await store.upsert_motif(
        db_session,
        multi,
        facets={"scope": "whole"},
        slot_parts=("outline", "body"),
    )
    await store.upsert_motif(
        db_session,
        multi,
        facets={"scope": "whole"},
        slot_labels=("detail", "secondary"),
        slot_parts=("changed", "parts"),
    )
    await db_session.commit()

    got = (await store.get_motifs(db_session, [multi.id]))[multi.id]
    assert first.id == labeled.id == parted.id == multi.id
    assert first.inserted is True
    assert labeled.inserted is False
    assert parted.inserted is False
    assert got.slot_colors == ("#010000", "#0685B1")
    assert got.slot_labels == ("outline", "primary")
    assert got.slot_parts == ("outline", "body")

    with pytest.raises(ValueError, match="index-aligned"):
        await store.upsert_motif(
            db_session,
            multi,
            facets={"scope": "whole"},
            slot_labels=("primary",),
        )
    with pytest.raises(ValueError, match="index-aligned"):
        await store.upsert_motif(
            db_session,
            multi,
            facets={"scope": "whole"},
            slot_parts=("body",),
        )


async def test_slot_metadata_backfill_selects_missing_public_multislot_and_is_idempotent(
    db_session,
):
    missing_both = NormalizedMotif(
        id="recraft-metadata-both",
        symbol=(
            '<symbol id="motif-recraft-metadata-both"><path fill="s0"/><path fill="s1"/></symbol>'
        ),
        color_slots=("s0", "s1"),
        slot_colors=("#111111", "#222222"),
    )
    missing_parts = NormalizedMotif(
        id="recraft-metadata-parts",
        symbol=(
            '<symbol id="motif-recraft-metadata-parts"><path fill="s0"/><path fill="s1"/></symbol>'
        ),
        color_slots=("s0", "s1"),
        slot_colors=("#333333", "#444444"),
    )
    missing_labels = NormalizedMotif(
        id="recraft-metadata-labels",
        symbol=(
            '<symbol id="motif-recraft-metadata-labels"><path fill="s0"/><path fill="s1"/></symbol>'
        ),
        color_slots=("s0", "s1"),
        slot_colors=("#555555", "#666666"),
    )
    private = NormalizedMotif(
        id="upload-metadata-private",
        symbol=(
            '<symbol id="motif-upload-metadata-private"><path fill="s0"/><path fill="s1"/></symbol>'
        ),
        color_slots=("s0", "s1"),
        slot_colors=("#777777", "#888888"),
    )
    await store.upsert_motif(db_session, missing_both, facets={"scope": "whole"}, source="seed")
    await store.upsert_motif(
        db_session,
        missing_parts,
        facets={"scope": "whole"},
        source="seed",
        slot_labels=("secondary", "accent"),
    )
    await store.upsert_motif(
        db_session,
        missing_labels,
        facets={"scope": "whole"},
        source="seed",
        slot_parts=("wing", "tail"),
    )
    await store.upsert_motif(
        db_session,
        private,
        facets={"scope": "whole"},
        source=store.USER_UPLOAD_SOURCE,
    )
    await db_session.commit()

    rows = await store.missing_slot_metadata_rows(db_session)
    assert [row.id for row in rows] == [
        missing_both.id,
        missing_labels.id,
        missing_parts.id,
    ]
    assert rows[0].slot_colors == ("#111111", "#222222")
    assert await store.update_slot_metadata_if_missing(
        db_session,
        missing_both.id,
        slot_labels=("primary", "detail"),
        slot_parts=("body", "outline"),
    )
    assert not await store.update_slot_metadata_if_missing(
        db_session,
        missing_both.id,
        slot_labels=("detail", "primary"),
        slot_parts=("changed", "parts"),
    )
    assert await store.update_slot_metadata_if_missing(
        db_session,
        missing_parts.id,
        slot_labels=("primary", "detail"),
        slot_parts=("body", "outline"),
    )
    assert await store.update_slot_metadata_if_missing(
        db_session,
        missing_labels.id,
        slot_labels=("outline", "primary"),
        slot_parts=("changed", "parts"),
    )
    await db_session.commit()

    assert await store.missing_slot_metadata_rows(db_session) == []
    stored = {row.id: row for row in (await db_session.scalars(select(Motif))).all()}
    assert stored[missing_both.id].slot_labels == ["primary", "detail"]
    assert stored[missing_both.id].slot_parts == ["body", "outline"]
    assert stored[missing_parts.id].slot_labels == ["secondary", "accent"]
    assert stored[missing_parts.id].slot_parts == ["body", "outline"]
    assert stored[missing_labels.id].slot_labels == ["outline", "primary"]
    assert stored[missing_labels.id].slot_parts == ["wing", "tail"]


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


async def test_nearest_by_embedding_uses_halfvec_distance(db_session):
    await store.upsert_motif(
        db_session,
        _motif("recraft-vertex-near"),
        facets={"scope": "whole"},
        embedding=_vec(1.0),
    )
    await store.upsert_motif(
        db_session,
        _motif("recraft-vertex-far"),
        facets={"scope": "whole"},
        embedding=_vec(0.0, 1.0),
    )
    await db_session.commit()

    matches = await store.nearest_by_embedding(db_session, _vec(1.0), top_k=1)

    assert matches[0].id == "recraft-vertex-near"
    assert matches[0].similarity == 1.0


async def test_nearest_excludes_null_embedding(db_session):
    await store.upsert_motif(db_session, _motif("recraft-nullembeddin"), facets={"scope": "whole"})
    await store.upsert_motif(
        db_session, _motif("recraft-hasembedding0"), facets={"scope": "whole"}, embedding=_vec(1.0)
    )
    await db_session.commit()
    matches = await store.nearest_by_embedding(db_session, _vec(1.0), top_k=1)
    assert matches[0].id == "recraft-hasembedding0"


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


async def test_embedding_index_updates_only_public_null_rows_and_is_idempotent(db_session):
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
        embedding=_vec(0.0, 1.0),
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

        async def embed(self, text: str, *, task_type: str) -> list[float]:
            assert task_type == "RETRIEVAL_DOCUMENT"
            self.texts.append(text)
            return _vec(1.0)

    client = _Embed()
    assert await index_missing_embeddings(db_session, client) == 1
    assert client.texts == ["chess, chess king outline, king"]
    assert await store.public_embedding_counts(db_session) == (2, 2)
    assert await index_missing_embeddings(db_session, client) == 0
    assert client.texts == ["chess, chess king outline, king"]


async def test_prune_stale_seeds_keeps_current_and_referenced(db_session):
    """에셋 수정으로 생긴 시드 고아만 지우고, 현재 시드·user_upload·참조 행은 남긴다."""
    for mid, source in [
        ("recraft-seedcurrent0", "seed"),
        ("recraft-seedstale000", "seed"),
        ("recraft-seedfaved00", "seed"),
        ("upload-keepme00000", store.USER_UPLOAD_SOURCE),
    ]:
        await store.upsert_motif(db_session, _motif(mid), facets={"scope": "whole"}, source=source)
    user_id = await db_session.scalar(text("insert into users (name) values ('t') returning id"))
    db_session.add(UserMotif(user_id=user_id, motif_id="recraft-seedfaved00", name="fav"))
    await db_session.commit()

    assert await store.prune_stale_seeds(db_session, ["recraft-seedcurrent0"]) == 1
    await db_session.commit()
    assert await store.all_motif_ids(db_session) == [
        "recraft-seedcurrent0",
        "recraft-seedfaved00",
    ]


async def test_prune_stale_seeds_empty_set_deletes_nothing(db_session):
    """빈 시드 집합은 no-op — 빈 notin_이 참으로 평가돼 전체 삭제되는 사고 방지."""
    await store.upsert_motif(
        db_session, _motif("recraft-seedonly0000"), facets={"scope": "whole"}, source="seed"
    )
    await db_session.commit()

    assert await store.prune_stale_seeds(db_session, []) == 0
    await db_session.commit()
    assert await store.all_motif_ids(db_session) == ["recraft-seedonly0000"]
