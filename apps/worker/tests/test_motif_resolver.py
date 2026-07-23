"""resolver DB 테스트 — 실컨테이너 + fake 어댑터 (worker-motifs.md §5).

subject/tag exact hit / global τ gate / no unrelated fallback / miss→generate /
variant pool seed 결정론 / present_candidates Recraft 미호출.
"""

import pytest
from sqlalchemy.exc import OperationalError
from worker.config import Settings
from worker.motifs import store
from worker.motifs.normalize import NormalizedMotif
from worker.motifs.resolver import (
    _strip_korean_particle,
    _tokens,
    present_candidates,
    prompt_catalog_candidates,
    resolve_motifs,
    resolve_spec,
)

DIM = 3072
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

    async def embed(self, text: str, *, task_type: str) -> list[float]:
        assert task_type == "RETRIEVAL_QUERY"
        self.calls += 1
        return self._vec


class _FakeRecraft:
    def __init__(self, svg: str = _CLEAN) -> None:
        self._svg = svg
        self.calls = 0

    async def generate(self, prompt: str) -> str:
        self.calls += 1
        return self._svg


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
    embedding = _FakeEmbed(_vec(1.0))
    result = await resolve_spec(
        db_session,
        {"subject": "circle", "scope": "whole", "description": "round geometric mark"},
        recraft_client=recraft,
        embedding_client=embedding,  # cosine 1.0 ≥ τ
        settings=_SETTINGS,
        seed=0,
    )
    assert result.motif_id == "recraft-simhit000000"
    assert result.reused is True
    assert result.match_type == "embedding"
    assert embedding.calls == 1
    assert recraft.calls == 0


async def test_embedding_below_tau_generates(db_session):
    await _seed(
        db_session, "recraft-simmiss00000", subject="dot", scope="whole", embedding=_vec(1.0)
    )
    recraft = _FakeRecraft()
    result = await resolve_spec(
        db_session,
        {"subject": "circle", "scope": "whole", "description": "orthogonal"},
        recraft_client=recraft,
        embedding_client=_FakeEmbed(_vec(0.0, 1.0)),  # cosine ~0 < τ → miss
        settings=_SETTINGS,
        seed=0,
    )
    assert result.reused is False
    assert result.motif_id.startswith("recraft-")
    assert recraft.calls == 1


async def test_no_embedding_does_not_reuse_unrelated_lowest_id(db_session):
    await _seed(db_session, "recraft-fallback0002", subject="dot", scope="whole")
    await _seed(db_session, "recraft-fallback0001", subject="dot", scope="whole")
    recraft = _FakeRecraft()
    result = await resolve_spec(
        db_session,
        {"subject": "unrelated", "scope": "whole", "description": "no exact match"},
        recraft_client=recraft,
        embedding_client=None,
        settings=_SETTINGS,
        seed=0,
    )
    assert result.motif_id not in {"recraft-fallback0001", "recraft-fallback0002"}
    assert result.reused is False
    assert result.similarity is None
    assert recraft.calls == 1


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


# --- 한국어 조사(格·補助詞) 정규화: 순수 토큰화 회귀 (DB 불필요) -------------------------


@pytest.mark.parametrize(
    ("prompt", "expected_stem"),
    [
        ("펠리컨을", "펠리컨"),
        ("펠리컨이", "펠리컨"),
        ("펠리컨은", "펠리컨"),
        ("펠리컨으로", "펠리컨"),
        ("펠리컨의", "펠리컨"),
        ("펠리컨에게", "펠리컨"),
        ("꿀벌을", "꿀벌"),
        ("벌을", "벌"),
        ("원을", "원"),
        ("원이", "원"),
        ("원과", "원"),
        ("원으로", "원"),
        ("펠리컨만을", "펠리컨"),  # 복합 보조사 '만을'
        ("나비를", "나비"),
    ],
)
def test_tokens_strips_korean_particle_to_reach_seed_tag(prompt, expected_stem):
    # 조사가 붙어도 어간 토큰이 합류해 seed 태그(펠리컨/꿀벌/원/나비…)와 exact-token 매칭된다.
    tokens = _tokens(prompt)
    assert expected_stem in tokens
    assert prompt in tokens  # 원문 토큰은 항상 보존


@pytest.mark.parametrize(
    ("prompt", "forbidden"),
    [
        ("정원을", "원"),  # 정원(garden) ≠ 원(circle)
        ("병원에서", "원"),  # 병원(hospital)
        ("공원도", "원"),  # 공원(park)
        ("화원의", "원"),  # 화원(flower shop)
        ("사당을", "달"),  # 사당 ≠ 달
    ],
)
def test_tokens_particle_strip_never_overmatches_substring(prompt, forbidden):
    # 조사는 토큰 '전체'의 끝에서만 떼므로 부분문자열(정원→원) 오매칭이 발생하지 않는다.
    assert forbidden not in _tokens(prompt)


@pytest.mark.parametrize(
    ("adverb", "subject_form", "tag"),
    [
        ("별로 화려하지 않게", "별을", "별"),  # 별로(그다지) ≠ 별(star)
        ("새로 배치해 주세요", "새를", "새"),  # 새로(새롭게) ≠ 새(bird)
        ("말로 설명하기 어려운", "말을", "말"),  # 말로(구어) ≠ 말(horse)
        ("달랑 하나만 넣어", "달을", "달"),  # 달랑(꼴랑) ≠ 달(moon)
        ("크게 말하고 싶은", "말을", "말"),  # 말하고(용언) ≠ 말(horse)
    ],
)
def test_tokens_homograph_adverbs_do_not_ground_but_subject_forms_do(adverb, subject_form, tag):
    # 조사 동형 고빈도어는 seed 태그를 못 만들고(denylist), 진짜 조사형 subject는 어간을 낸다.
    assert tag not in _tokens(adverb)
    assert tag in _tokens(subject_form)


def test_tokens_bare_ro_particle_still_reduces_non_homographs():
    # denylist가 정상 '로' 절단까지 막으면 안 된다: "격자로"→"격자"는 유지.
    assert "격자" in _tokens("격자로 반복")


@pytest.mark.parametrize(
    ("prompt", "expected_stem"),
    [
        ("꿀벌이랑", "꿀벌"),  # 자음 종성 + 이랑
        ("나비랑", "나비"),  # 모음 종성 + 랑
        ("펠리컨하고", "펠리컨"),  # 하고
        ("고래하고", "고래"),
    ],
)
def test_tokens_strips_colloquial_conjunctions(prompt, expected_stem):
    # 구어 접속조사(이랑/랑/하고)로 나열해도 첫 항이 seed로 붙는다(리콜 회귀 방지).
    assert expected_stem in _tokens(prompt)


def test_tokens_alias_applies_to_stripped_stem():
    assert "flower" in _tokens("꽃을")
    assert "moon" in _tokens("달을")
    assert "butterfly" in _tokens("나비를")


def test_tokens_leaves_english_and_bare_particles_untouched():
    assert _tokens("chess pattern") == {"chess", "pattern"}
    assert _tokens("pelican lattice") == {"pelican", "lattice"}
    assert _tokens("을") == {"을"}  # 어간 없는 조사-only 토큰은 그대로


def test_strip_korean_particle_guards():
    assert _strip_korean_particle("펠리컨을") == "펠리컨"
    assert _strip_korean_particle("원으로") == "원"  # 가장 긴 조사 우선('으로'>'로')
    assert _strip_korean_particle("정원을") == "정원"  # 어간은 토큰 전체 - 끝 조사
    assert _strip_korean_particle("을") is None  # 어간이 비면 None
    assert _strip_korean_particle("a을") is None  # 한글 어간 아니면 None
    assert _strip_korean_particle("pelican") is None  # 한글 없음


# --- 카탈로그 grounding: 실 DB 통합 (embedding 없이 lexical exact-token) --------------------


async def test_prompt_catalog_candidates_matches_korean_particle_form_without_embedding(db_session):
    # seed 모티프(embedding NULL)를 조사형 자연어 프롬프트로 grounding — 벡터 경로 없이 성립해야.
    await _seed(
        db_session,
        "recraft-pelican00001",
        subject="pelican",
        scope="whole",
        description="pelican outline",
        tags=["pelican", "펠리컨"],
    )
    await _seed(
        db_session,
        "recraft-flower000001",
        subject="flower",
        scope="whole",
        description="flower outline",
        tags=["flower", "꽃"],
    )

    candidates = await prompt_catalog_candidates(
        db_session,
        "펠리컨을 격자로 반복해 주세요",
        embedding_client=None,  # seed는 임베딩이 없음 — lexical 경로만으로 잡혀야 한다
        tau=0.84,
    )

    assert [candidate["motif_id"] for candidate in candidates] == ["recraft-pelican00001"]
    assert candidates[0]["match_type"] == "exact_token"


async def test_prompt_catalog_candidates_grounds_two_seeds_with_particles(db_session):
    await _seed(
        db_session, "recraft-bee00000001", subject="bee", scope="whole", tags=["bee", "꿀벌", "벌"]
    )
    await _seed(
        db_session,
        "recraft-circle00001",
        subject="circle",
        scope="whole",
        tags=["circle", "원", "동그라미"],
    )

    candidates = await prompt_catalog_candidates(
        db_session,
        "꿀벌과 원을 함께 흩뿌려 주세요",
        embedding_client=None,
        tau=0.84,
    )

    matched = {candidate["motif_id"] for candidate in candidates}
    assert matched == {"recraft-bee00000001", "recraft-circle00001"}
    assert all(candidate["match_type"] == "exact_token" for candidate in candidates)


async def test_prompt_catalog_candidates_homograph_adverb_does_not_ground(db_session):
    # "새로"(새롭게)는 bird seed(태그 '새')를 grounding하면 안 된다 — 동형어 오매칭 회귀 가드.
    await _seed(
        db_session, "recraft-bird00000001", subject="bird", scope="whole", tags=["bird", "새"]
    )

    adverb = await prompt_catalog_candidates(
        db_session, "무늬를 새로 만들어 주세요", embedding_client=None, tau=0.84
    )
    assert adverb == []

    named = await prompt_catalog_candidates(
        db_session, "새를 대각 경로로 늘어놓아 주세요", embedding_client=None, tau=0.84
    )
    assert [c["motif_id"] for c in named] == ["recraft-bird00000001"]


async def test_prompt_catalog_candidates_colloquial_conjunction_grounds_both(db_session):
    # 구어 "꿀벌이랑 원을" — 첫 항(꿀벌)도 seed로 붙어야 한다(리콜 회귀 가드).
    await _seed(
        db_session, "recraft-bee00000001", subject="bee", scope="whole", tags=["bee", "꿀벌", "벌"]
    )
    await _seed(
        db_session,
        "recraft-circle00001",
        subject="circle",
        scope="whole",
        tags=["circle", "원", "동그라미"],
    )

    candidates = await prompt_catalog_candidates(
        db_session, "꿀벌이랑 원을 촘촘하게 배치해 주세요", embedding_client=None, tau=0.84
    )
    assert {c["motif_id"] for c in candidates} == {"recraft-bee00000001", "recraft-circle00001"}


async def test_prompt_catalog_candidates_counter_does_not_ground_dog(db_session):
    # "N 개"(단위 명사)는 dog을 grounding하면 안 된다 — seed 태그에서 계수어 동형 '개'를 뺐다.
    # "개의"→"개"로 떼도 태그에 '개'가 없어 미매칭. '강아지'는 여전히 매칭된다.
    await _seed(
        db_session, "recraft-dog00000001", subject="dog", scope="whole", tags=["dog", "강아지"]
    )

    counting = await prompt_catalog_candidates(
        db_session,
        "밴드를 두 개의 얇은 줄로 나눠 주세요",
        embedding_client=None,
        tau=0.84,
    )
    assert counting == []

    named = await prompt_catalog_candidates(
        db_session,
        "강아지를 촘촘한 격자로 배치해 주세요",
        embedding_client=None,
        tau=0.84,
    )
    assert [c["motif_id"] for c in named] == ["recraft-dog00000001"]


async def test_prompt_catalog_candidates_particle_strip_does_not_overmatch(db_session):
    # '정원을'(garden)은 '원'(circle) seed를 절대 grounding하지 않아야 한다 — 오매칭 회귀 가드.
    await _seed(
        db_session,
        "recraft-circle00001",
        subject="circle",
        scope="whole",
        tags=["circle", "원", "동그라미"],
    )

    candidates = await prompt_catalog_candidates(
        db_session,
        "정원을 가꾸는 듯한 무늬로 채워 주세요",
        embedding_client=None,
        tau=0.84,
    )

    assert candidates == []


async def test_prompt_catalog_candidates_find_chess_by_exact_token_without_embedding(db_session):
    await _seed(
        db_session,
        "recraft-chess0000001",
        subject="chess",
        scope="whole",
        description="chess king outline",
    )
    await _seed(
        db_session,
        "recraft-flower000001",
        subject="flower",
        scope="whole",
        description="flower outline",
    )

    candidates = await prompt_catalog_candidates(
        db_session,
        "chess 패턴 디자인해주세요",
        embedding_client=None,
        tau=0.84,
    )

    assert [candidate["motif_id"] for candidate in candidates] == ["recraft-chess0000001"]
    assert candidates[0]["catalog_ref"] == "catalog_1"
    assert candidates[0]["match_type"] == "exact_token"


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
    trace: list[dict[str, object]] = []
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
        trace=trace,
    )
    assert recraft.calls == 0  # 미지원 spec은 생성 래더 진입 금지, m2는 exact 재사용
    ids = [layer["id"] for layer in resolved["layers"]]
    assert ids == ["bg", "m2"]  # m1만 drop, 요청은 계속
    assert any("unsupported spec field(s) text" in w for w in warnings)
    assert trace == [
        {
            "layer_id": "m1",
            "subject": None,
            "scope": None,
            "outcome": "dropped",
            "reason_code": "unsupported_spec",
        },
        {
            "layer_id": "m2",
            "subject": "dot",
            "scope": "whole",
            "outcome": "prompt_catalog",
            "motif_id": "recraft-ok0000000001",
            "similarity": 1.0,
            "match_type": "exact_token",
        },
    ]


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


async def test_required_unsupported_spec_cannot_degrade_to_partial_success(db_session):
    from worker.adapters import AdapterClientError

    await _seed(db_session, "recraft-ok0000000001", subject="dot", scope="whole")
    recraft = _FakeRecraft()
    intent = {
        "layers": [
            {"id": "bg", "type": "background", "params": {}},
            {"id": "required", "type": "motif", "params": {}},
            {"id": "valid", "type": "motif", "params": {}},
        ]
    }

    with pytest.raises(AdapterClientError):
        await resolve_motifs(
            db_session,
            intent,
            [
                {"layer_id": "required", "text": "ESSE", "required": True},
                {"layer_id": "valid", "subject": "dot", "scope": "whole"},
            ],
            recraft_client=recraft,
            embedding_client=None,
            settings=_SETTINGS,
            seed=0,
        )
    assert recraft.calls == 0


async def test_store_read_failure_degrades_to_generate(db_session, monkeypatch):
    # 조회의 일시 DB 오류는 miss로 흡수(§6.4) — content-hash upsert가 멱등이라 정합.
    async def _boom(session):
        raise OperationalError("SELECT 1", None, Exception("connection dropped"))

    monkeypatch.setattr(store, "find_catalog", _boom)
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


async def test_read_failure_does_not_rollback_earlier_uncommitted_motif(db_session, monkeypatch):
    first = await resolve_spec(
        db_session,
        {"subject": "first", "scope": "whole"},
        recraft_client=_FakeRecraft(),
        embedding_client=None,
        settings=_SETTINGS,
        seed=0,
    )

    async def _boom(session):
        raise OperationalError("SELECT 1", None, Exception("statement failed"))

    monkeypatch.setattr(store, "find_catalog", _boom)
    second_svg = _CLEAN.replace("circle", "ellipse").replace(' r="30"', ' rx="30" ry="20"')
    second = await resolve_spec(
        db_session,
        {"subject": "second", "scope": "whole"},
        recraft_client=_FakeRecraft(second_svg),
        embedding_client=None,
        settings=_SETTINGS,
        seed=0,
    )
    await db_session.commit()

    assert first.motif_id != second.motif_id
    stored = await store.get_motifs(db_session, [first.motif_id, second.motif_id])
    assert set(stored) == {first.motif_id, second.motif_id}


async def test_nearest_read_failure_generates_instead_of_catalog_fallback(db_session, monkeypatch):
    await _seed(db_session, "recraft-degrade00001", subject="dot", scope="whole")

    async def _boom(session, vec, top_k=1):
        raise OperationalError("SELECT 1", None, Exception("connection dropped"))

    monkeypatch.setattr(store, "nearest_by_embedding", _boom)
    recraft = _FakeRecraft()
    result = await resolve_spec(
        db_session,
        {"subject": "circle", "scope": "whole", "description": "not exact"},
        recraft_client=recraft,
        embedding_client=_FakeEmbed(_vec(1.0)),
        settings=_SETTINGS,
        seed=0,
    )
    assert result.motif_id != "recraft-degrade00001"
    assert result.reused is False
    assert result.similarity is None
    assert recraft.calls == 1


async def test_registry_version_fingerprint_moves_with_pool(db_session):
    from worker.engine.determinism import REGISTRY_VERSION
    from worker.motifs.fingerprint import registry_version_for

    assert await registry_version_for(db_session) == REGISTRY_VERSION  # 빈 풀 → baseline
    await _seed(db_session, "recraft-fp0000000001", subject="dot", scope="whole")
    stamped = await registry_version_for(db_session)
    assert stamped.startswith(f"{REGISTRY_VERSION}+pool.")
