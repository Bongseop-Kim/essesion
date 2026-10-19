"""store DB 테스트 — 실제 Postgres (worker-motifs.md §1).

upsert 멱등 · get_motifs bbox/anchor 변환 · 지문 풀(approved 공개 모티프) · 고아 시드 정리.
"""

from db.models.design import DesignSession, DesignSessionTurn, UserMotif
from db.models.seamless import Motif
from sqlalchemy import text
from worker.motifs import store
from worker.motifs.normalize import NormalizedMotif
from worker.motifs.registry import MotifDef


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


async def test_user_upload_is_only_available_by_explicit_id(db_session):
    uploaded = _motif("upload-a1b2c3d4e5f6")
    await _upsert(
        db_session,
        uploaded,
        facets={"subject": "private", "scope": "whole"},
        source=store.USER_UPLOAD_SOURCE,
    )
    await db_session.commit()

    assert (await store.get_motifs(db_session, [uploaded.id]))[uploaded.id].id == uploaded.id
    assert await store.approved_motif_ids(db_session) == []


async def test_registry_pool_only_counts_approved_public_motifs(db_session):
    for motif_id, status in (
        ("fixture-gate-approved", "approved"),
        ("fixture-gate-pending", "pending"),
        ("fixture-gate-rejected", "rejected"),
    ):
        await _upsert(
            db_session,
            _motif(motif_id),
            facets={"subject": "gate", "scope": "whole"},
            status=status,
        )
    await db_session.commit()

    assert await store.approved_motif_ids(db_session) == ["fixture-gate-approved"]


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
