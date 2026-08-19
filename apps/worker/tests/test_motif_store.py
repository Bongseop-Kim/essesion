"""store DB 테스트 — 실제 Postgres(pgvector) (worker-motifs.md §1·§5).

upsert 멱등 · get_motifs bbox/anchor 변환 · global nearest 안정 정렬 · embedding NULL 제외 ·
공개 embedding 초기 인덱싱.
"""

from db.models.design import DesignSession, DesignSessionTurn, UserMotif
from db.models.seamless import Motif
from sqlalchemy import text
from worker.motifs import store
from worker.motifs.embeddings import index_missing_embeddings
from worker.motifs.normalize import NormalizedMotif
from worker.motifs.registry import MotifDef

DIM = 1536


def _vec(*head: float) -> list[float]:
    return list(head) + [0.0] * (DIM - len(head))


def _motif(mid: str) -> NormalizedMotif:
    return NormalizedMotif(
        id=mid,
        symbol=(
            f'<symbol id="motif-{mid}" overflow="visible"><circle r="0.5" fill="#123456"/></symbol>'
        ),
    )


async def _upsert(session, motif, *, source="seed", **kwargs) -> None:
    await store.upsert_motif(session, motif, source=source, **kwargs)


async def test_upsert_is_idempotent(db_session):
    m = _motif("fixture-aaaaaaaaaaaa")
    await _upsert(db_session, m, facets={"subject": "dot", "scope": "whole"})
    await _upsert(db_session, m, facets={"subject": "dot", "scope": "whole"})
    await db_session.commit()
    row = await db_session.get(Motif, m.id)
    assert row is not None
    assert row.status == "pending"
    assert await store.approved_motif_ids(db_session) == []


async def test_get_motifs_converts_bbox_and_anchor_to_tuples(db_session):
    await _upsert(db_session, _motif("fixture-bbbbbbbbbbbb"), facets={"scope": "whole"})
    await db_session.commit()
    got = await store.get_motifs(db_session, ["fixture-bbbbbbbbbbbb"])
    md = got["fixture-bbbbbbbbbbbb"]
    assert isinstance(md, MotifDef)
    assert md.bbox_mm == (-0.5, -0.5, 0.5, 0.5)
    assert md.anchor == (0.0, 0.0)


async def test_get_motifs_empty_ids_returns_empty(db_session):
    assert await store.get_motifs(db_session, []) == {}


async def test_nearest_by_embedding_tie_breaks_on_lowest_id(db_session):
    await _upsert(
        db_session,
        _motif("fixture-000000000002"),
        facets={"scope": "whole"},
        embedding=_vec(1.0),
        status="approved",
    )
    await _upsert(
        db_session,
        _motif("fixture-000000000001"),
        facets={"scope": "whole"},
        embedding=_vec(1.0),
        status="approved",
    )
    await db_session.commit()
    matches = await store.nearest_by_embedding(db_session, _vec(1.0), top_k=1)
    assert matches[0].id == "fixture-000000000001"  # 동점 → lowest id
    assert matches[0].similarity == 1.0


async def test_nearest_by_embedding_uses_halfvec_distance(db_session):
    await _upsert(
        db_session,
        _motif("fixture-embed-near"),
        facets={"scope": "whole"},
        embedding=_vec(1.0),
        status="approved",
    )
    await _upsert(
        db_session,
        _motif("fixture-embed-far"),
        facets={"scope": "whole"},
        embedding=_vec(0.0, 1.0),
        status="approved",
    )
    await db_session.commit()

    matches = await store.nearest_by_embedding(db_session, _vec(1.0), top_k=1)

    assert matches[0].id == "fixture-embed-near"
    assert matches[0].similarity == 1.0


async def test_nearest_excludes_null_embedding(db_session):
    await _upsert(
        db_session,
        _motif("fixture-nullembeddin"),
        facets={"scope": "whole"},
        status="approved",
    )
    await _upsert(
        db_session,
        _motif("fixture-hasembedding0"),
        facets={"scope": "whole"},
        embedding=_vec(1.0),
        status="approved",
    )
    await db_session.commit()
    matches = await store.nearest_by_embedding(db_session, _vec(1.0), top_k=1)
    assert matches[0].id == "fixture-hasembedding0"


async def test_user_upload_is_only_available_by_explicit_id(db_session):
    uploaded = _motif("upload-a1b2c3d4e5f6")
    await _upsert(
        db_session,
        uploaded,
        facets={"subject": "private", "scope": "whole"},
        embedding=_vec(1.0),
        source=store.USER_UPLOAD_SOURCE,
    )
    await db_session.commit()

    assert (await store.get_motifs(db_session, [uploaded.id]))[uploaded.id].id == uploaded.id
    assert await store.approved_motif_ids(db_session) == []
    assert await store.nearest_by_embedding(db_session, _vec(1.0), top_k=1) == []


async def test_catalog_queries_only_expose_approved_motifs(db_session):
    rows = [
        ("fixture-gate-approved", "approved", _vec(1.0)),
        ("fixture-gate-unembedded", "approved", None),
        ("fixture-gate-pending", "pending", _vec(1.0)),
        ("fixture-gate-rejected", "rejected", _vec(1.0)),
    ]
    for motif_id, status, embedding in rows:
        await _upsert(
            db_session,
            _motif(motif_id),
            facets={"subject": "gate", "scope": "whole"},
            embedding=embedding,
            status=status,
        )
    await db_session.commit()

    approved_ids = {"fixture-gate-approved", "fixture-gate-unembedded"}
    assert {row.id for row in await store.find_catalog(db_session)} == approved_ids
    assert [
        row.id for row in await store.nearest_by_embedding(db_session, _vec(1.0), top_k=10)
    ] == ["fixture-gate-approved"]
    assert [row.id for row in await store.missing_embedding_documents(db_session)] == [
        "fixture-gate-unembedded"
    ]
    assert await store.public_embedding_counts(db_session) == (1, 2)
    assert set(await store.approved_motif_ids(db_session)) == approved_ids
    assert set(await store.get_motifs(db_session, [row[0] for row in rows])) == {
        row[0] for row in rows
    }


async def test_global_nearest_does_not_filter_partial_scope(db_session):
    await _upsert(
        db_session,
        _motif("fixture-partialmatch"),
        facets={"scope": "partial"},
        embedding=_vec(1.0),
        status="approved",
    )
    await _upsert(
        db_session,
        _motif("fixture-wholemiss000"),
        facets={"scope": "whole"},
        embedding=_vec(0.0, 1.0),
        status="approved",
    )
    await db_session.commit()

    matches = await store.nearest_by_embedding(db_session, _vec(1.0), top_k=2)
    assert matches[0].id == "fixture-partialmatch"


async def test_embedding_index_updates_only_public_null_rows_and_is_idempotent(db_session):
    await _upsert(
        db_session,
        _motif("fixture-public-null"),
        facets={
            "subject": "chess",
            "scope": "whole",
            "description": "chess king outline",
            "tags": ["king"],
        },
        status="approved",
    )
    await _upsert(
        db_session,
        _motif("fixture-public-done"),
        facets={"subject": "flower", "scope": "whole"},
        embedding=_vec(0.0, 1.0),
        status="approved",
    )
    await _upsert(
        db_session,
        _motif("upload-private-null"),
        facets={"subject": "private", "scope": "whole"},
        source=store.USER_UPLOAD_SOURCE,
    )
    await db_session.commit()

    class _Embed:
        def __init__(self):
            self.texts: list[str] = []

        async def embed_batch(self, texts: list[str]) -> list[list[float]]:
            self.texts.extend(texts)
            return [_vec(1.0) for _ in texts]

    client = _Embed()
    assert await index_missing_embeddings(db_session, client) == 1
    assert client.texts == ["chess, chess king outline, king"]
    assert await store.public_embedding_counts(db_session) == (2, 2)
    assert await index_missing_embeddings(db_session, client) == 0
    assert client.texts == ["chess, chess king outline, king"]


async def test_pending_motif_stores_no_embedding_until_approved(db_session):
    """승인 전 embedding 저장 금지 — 승인 후 인덱서가 DOCUMENT 임베딩을 채울 수 있어야 한다."""
    m = _motif("fixture-pendingembed")
    await _upsert(
        db_session,
        m,
        facets={"subject": "owl", "scope": "whole"},
        embedding=_vec(1.0),  # resolve_spec이 넘기던 query_vec — 무시돼야 한다
    )
    await db_session.commit()
    row = await db_session.get(Motif, m.id)
    assert row is not None
    assert row.embedding_openai is None
    assert await store.update_embedding_if_missing(db_session, m.id, _vec(1.0)) is False

    row.status = "approved"
    await db_session.commit()
    assert [doc.id for doc in await store.missing_embedding_documents(db_session)] == [m.id]
    assert await store.update_embedding_if_missing(db_session, m.id, _vec(1.0)) is True
    await db_session.commit()
    assert await store.public_embedding_counts(db_session) == (1, 1)


async def test_prune_stale_seeds_keeps_current_and_referenced(db_session):
    """에셋 수정으로 생긴 시드 고아만 지우고, 현재 시드·user_upload·참조 행은 남긴다."""
    for mid, source in [
        ("fixture-seedcurrent0", "seed"),
        ("fixture-seedstale000", "seed"),
        ("fixture-seedfaved00", "seed"),
        ("upload-keepme00000", store.USER_UPLOAD_SOURCE),
    ]:
        await _upsert(
            db_session,
            _motif(mid),
            facets={"scope": "whole"},
            source=source,
            status="approved" if source == "seed" else "pending",
        )
    user_id = await db_session.scalar(text("insert into users (name) values ('t') returning id"))
    db_session.add(UserMotif(user_id=user_id, motif_id="fixture-seedfaved00", name="fav"))
    await db_session.commit()

    assert await store.prune_stale_seeds(db_session, ["fixture-seedcurrent0"]) == 1
    await db_session.commit()
    assert await store.approved_motif_ids(db_session) == [
        "fixture-seedcurrent0",
        "fixture-seedfaved00",
    ]


async def test_prune_stale_seeds_keeps_ids_referenced_only_from_json(db_session):
    """세션 intent·plan·턴 payload의 motif id는 FK가 없다 — 텍스트로 훑어서 살려야 한다.

    FK만 보고 지우면 살아 있는 세션의 디자인이 없는 모티프를 가리키게 된다.
    """
    for mid in (
        "fixture-jsonintent00",
        "fixture-jsonplan0000",
        "fixture-jsonturn0000",
        # 어디서도 참조되지 않는 시드 — JSON 훑기가 과잉 보존하지 않는지 함께 본다.
        "fixture-jsonorphan00",
    ):
        await _upsert(
            db_session,
            _motif(mid),
            facets={"scope": "whole"},
            source="seed",
            status="approved",
        )
    user_id = await db_session.scalar(text("insert into users (name) values ('t') returning id"))
    session_row = DesignSession(
        user_id=user_id,
        # 실제 intent와 같이 중첩 안쪽에 들어 있어야 한다 — 최상위 키만 보면 놓친다.
        current_intent={"layers": [{"kind": "motif", "motif_id": "fixture-jsonintent00"}]},
        current_plan={"motifs": [{"source": "catalog", "id": "fixture-jsonplan0000"}]},
    )
    db_session.add(session_row)
    await db_session.flush()
    db_session.add(
        DesignSessionTurn(
            session_id=session_row.id,
            seq=1,
            role="assistant",
            payload={"intent": {"layers": [{"motif_id": "fixture-jsonturn0000"}]}},
        )
    )
    await db_session.commit()

    # 현재 시드 집합에 넷 다 없다 — JSON이 가리키는 셋만 살고 고아는 지워져야 한다.
    assert await store.prune_stale_seeds(db_session, ["fixture-unrelated0000"]) == 1
    await db_session.commit()
    assert await store.approved_motif_ids(db_session) == [
        "fixture-jsonintent00",
        "fixture-jsonplan0000",
        "fixture-jsonturn0000",
    ]


async def test_prune_stale_seeds_empty_set_deletes_nothing(db_session):
    """빈 시드 집합은 no-op — 빈 notin_이 참으로 평가돼 전체 삭제되는 사고 방지."""
    await _upsert(
        db_session,
        _motif("fixture-seedonly0000"),
        facets={"scope": "whole"},
        source="seed",
        status="approved",
    )
    await db_session.commit()

    assert await store.prune_stale_seeds(db_session, []) == 0
    await db_session.commit()
    assert await store.approved_motif_ids(db_session) == ["fixture-seedonly0000"]
