"""resolver DB 테스트 — 실컨테이너 + fake 어댑터 (worker-motifs.md §5).

exact hit / τ 게이트 / hard-filter 폴백 / miss→generate / variant pool seed 결정론 /
present_candidates Recraft 미호출.
"""

import pytest
from sqlalchemy.exc import OperationalError
from worker.config import Settings
from worker.motifs import store
from worker.motifs.normalize import NormalizedMotif
from worker.motifs.resolver import present_candidates, resolve_motifs, resolve_spec

DIM = 1536
_SETTINGS = Settings(motif_render_check=False, motif_similarity_tau=0.84)
_CLEAN = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    '<circle cx="50" cy="50" r="30" fill="#ff0000"/></svg>'
)


def _vec(*head: float) -> list[float]:
    return list(head) + [0.0] * (DIM - len(head))


def _motif(mid: str) -> NormalizedMotif:
    return NormalizedMotif(
        id=mid, symbol=f'<symbol id="motif-{mid}" overflow="visible"><circle r="0.5"/></symbol>'
    )


class _FakeEmbed:
    model = "test"

    def __init__(self, vec: list[float]) -> None:
        self._vec = vec
        self.calls = 0

    async def embed(self, text: str) -> list[float]:
        self.calls += 1
        return self._vec


class _FakeRecraft:
    def __init__(self) -> None:
        self.calls = 0

    async def generate(self, prompt: str) -> str:
        self.calls += 1
        return _CLEAN


async def _seed(session, mid, **facets):
    embedding = facets.pop("embedding", None)
    vg = facets.pop("variant_group", None)
    await store.upsert_motif(
        session, _motif(mid), facets=facets, embedding=embedding, source="seed", variant_group=vg
    )
    await session.commit()


async def test_exact_facet_match_reuses(db_session):
    await _seed(db_session, "recraft-exact0000000", subject="dot", scope="whole", style="flat")
    recraft = _FakeRecraft()
    result = await resolve_spec(
        db_session,
        {"subject": "dot", "scope": "whole", "style": "flat"},
        recraft_client=recraft,
        embedding_client=None,
        settings=_SETTINGS,
        seed=0,
    )
    assert result.motif_id == "recraft-exact0000000"
    assert result.reused is True
    assert result.similarity == 1.0
    assert recraft.calls == 0  # 재사용 → Recraft 미호출


async def test_embedding_at_or_above_tau_reuses(db_session):
    await _seed(
        db_session, "recraft-simhit000000", subject="dot", scope="whole", embedding=_vec(1.0)
    )
    recraft = _FakeRecraft()
    result = await resolve_spec(
        db_session,
        {"subject": "dot", "scope": "whole", "description": "distinct so not exact"},
        recraft_client=recraft,
        embedding_client=_FakeEmbed(_vec(1.0)),  # cosine 1.0 ≥ τ
        settings=_SETTINGS,
        seed=0,
    )
    assert result.motif_id == "recraft-simhit000000"
    assert result.reused is True
    assert recraft.calls == 0


async def test_embedding_below_tau_generates(db_session):
    await _seed(
        db_session, "recraft-simmiss00000", subject="dot", scope="whole", embedding=_vec(1.0)
    )
    recraft = _FakeRecraft()
    result = await resolve_spec(
        db_session,
        {"subject": "dot", "scope": "whole", "description": "orthogonal"},
        recraft_client=recraft,
        embedding_client=_FakeEmbed(_vec(0.0, 1.0)),  # cosine ~0 < τ → miss
        settings=_SETTINGS,
        seed=0,
    )
    assert result.reused is False
    assert result.motif_id.startswith("recraft-")
    assert recraft.calls == 1


async def test_hard_filter_fallback_lowest_id_when_no_embedding(db_session):
    await _seed(db_session, "recraft-fallback0002", subject="dot", scope="whole")
    await _seed(db_session, "recraft-fallback0001", subject="dot", scope="whole")
    recraft = _FakeRecraft()
    result = await resolve_spec(
        db_session,
        {"subject": "dot", "scope": "whole", "description": "no exact match"},
        recraft_client=recraft,
        embedding_client=None,  # 쿼리 벡터 없음 → 하드필터 폴백
        settings=_SETTINGS,
        seed=0,
    )
    assert result.motif_id == "recraft-fallback0001"
    assert result.reused is True
    assert result.similarity is None
    assert recraft.calls == 0


async def test_miss_generates_when_scope_empty(db_session):
    recraft = _FakeRecraft()
    result = await resolve_spec(
        db_session,
        {"subject": "novel", "scope": "whole"},
        recraft_client=recraft,
        embedding_client=None,
        settings=_SETTINGS,
        seed=0,
    )
    assert result.reused is False
    assert recraft.calls == 1


async def test_variant_pool_seed_is_deterministic(db_session):
    vg = store.variant_group_key("flower", "whole")
    await _seed(
        db_session, "recraft-pool00000001", subject="flower", scope="whole", variant_group=vg
    )
    await _seed(
        db_session, "recraft-pool00000002", subject="flower", scope="whole", variant_group=vg
    )
    spec = {"subject": "flower", "scope": "whole"}

    async def _resolve(seed):
        return (
            await resolve_spec(
                db_session,
                spec,
                recraft_client=_FakeRecraft(),
                embedding_client=None,
                settings=_SETTINGS,
                seed=seed,
            )
        ).motif_id

    first = await _resolve(7)
    again = await _resolve(7)
    assert first == again  # 같은 seed → 같은 선택
    assert first in {"recraft-pool00000001", "recraft-pool00000002"}


async def test_present_candidates_never_calls_recraft(db_session):
    await _seed(db_session, "recraft-cand00000001", subject="dot", scope="whole", style="flat")
    await _seed(db_session, "recraft-cand00000002", subject="dot", scope="whole")
    cands = await present_candidates(
        db_session,
        {"subject": "dot", "scope": "whole", "style": "flat"},
        embedding_client=None,
        top_k=5,
    )
    assert cands[0]["motif_id"] == "recraft-cand00000001"  # exact 우선
    assert cands[0]["similarity"] == 1.0
    assert {c["motif_id"] for c in cands} == {"recraft-cand00000001", "recraft-cand00000002"}


async def test_unsupported_spec_fields_drop_layer_without_recraft(db_session):
    # glyph/vectorize 미구현 가드 — text spec은 Recraft로 흘리지 않고 해당 레이어만 drop.
    await _seed(db_session, "recraft-ok0000000001", subject="dot", scope="whole", style="flat")
    recraft = _FakeRecraft()
    intent = {
        "layers": [
            {"id": "bg", "type": "background", "params": {}},
            {"id": "m1", "type": "motif", "params": {}},
            {"id": "m2", "type": "motif", "params": {}},
        ]
    }
    warnings: list[str] = []
    resolved = await resolve_motifs(
        db_session,
        intent,
        [
            {"layer_id": "m1", "text": "ESSE"},
            {"layer_id": "m2", "subject": "dot", "scope": "whole", "style": "flat"},
        ],
        recraft_client=recraft,
        embedding_client=None,
        settings=_SETTINGS,
        seed=0,
        warnings=warnings,
    )
    assert recraft.calls == 0  # 미지원 spec은 생성 래더 진입 금지, m2는 exact 재사용
    ids = [layer["id"] for layer in resolved["layers"]]
    assert ids == ["bg", "m2"]  # m1만 drop, 요청은 계속
    assert any("unsupported spec field(s) text" in w for w in warnings)


async def test_all_unsupported_specs_raise_without_recraft(db_session):
    from worker.adapters import AdapterClientError

    recraft = _FakeRecraft()
    intent = {"layers": [{"id": "m1", "type": "motif", "params": {}}]}
    with pytest.raises(AdapterClientError):
        await resolve_motifs(
            db_session,
            intent,
            [{"layer_id": "m1", "source_image_index": 0}],
            recraft_client=recraft,
            embedding_client=None,
            settings=_SETTINGS,
            seed=0,
        )
    assert recraft.calls == 0


async def test_store_read_failure_degrades_to_generate(db_session, monkeypatch):
    # 조회의 일시 DB 오류는 miss로 흡수(§6.4) — content-hash upsert가 멱등이라 정합.
    async def _boom(session, scope):
        raise OperationalError("SELECT 1", None, Exception("connection dropped"))

    monkeypatch.setattr(store, "find_by_scope", _boom)
    recraft = _FakeRecraft()
    result = await resolve_spec(
        db_session,
        {"subject": "dot", "scope": "whole"},
        recraft_client=recraft,
        embedding_client=None,
        settings=_SETTINGS,
        seed=0,
    )
    assert result.reused is False
    assert result.motif_id.startswith("recraft-")
    assert recraft.calls == 1  # 조회 실패 → 생성 래더 폴백, upsert는 정상 진행


async def test_nearest_read_failure_falls_back_to_hard_filter(db_session, monkeypatch):
    await _seed(db_session, "recraft-degrade00001", subject="dot", scope="whole")

    async def _boom(session, vec, scope=None):
        raise OperationalError("SELECT 1", None, Exception("connection dropped"))

    monkeypatch.setattr(store, "nearest_by_embedding", _boom)
    recraft = _FakeRecraft()
    result = await resolve_spec(
        db_session,
        {"subject": "dot", "scope": "whole", "description": "not exact"},
        recraft_client=recraft,
        embedding_client=_FakeEmbed(_vec(1.0)),
        settings=_SETTINGS,
        seed=0,
    )
    assert result.motif_id == "recraft-degrade00001"  # τ 조회 실패 → 하드필터 폴백 재사용
    assert result.reused is True
    assert result.similarity is None
    assert recraft.calls == 0


async def test_registry_version_fingerprint_moves_with_pool(db_session):
    from worker.engine.determinism import REGISTRY_VERSION
    from worker.motifs.fingerprint import registry_version_for

    assert await registry_version_for(db_session) == REGISTRY_VERSION  # 빈 풀 → baseline
    await _seed(db_session, "recraft-fp0000000001", subject="dot", scope="whole")
    stamped = await registry_version_for(db_session)
    assert stamped.startswith(f"{REGISTRY_VERSION}+pool.")
