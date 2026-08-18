"""/motifs/* + /generate 모티프 경로 API 테스트 — 실컨테이너 (worker-motifs.md §3~§6)."""

import io
import json

import httpx
import respx
from PIL import Image
from worker.adapters.llm import AuthoredDesign, LLMClient
from worker.motifs import store
from worker.motifs.normalize import normalize_motif_svg

_CIRCLE = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    '<circle cx="50" cy="50" r="30" fill="#ff0000"/></svg>'
)
_RUN_ID = "11111111-1111-4111-8111-111111111111"


def _generated_png() -> bytes:
    image = Image.new("RGB", (64, 64), "white")
    for y in range(16, 48):
        for x in range(16, 48):
            image.putpixel((x, y), (20, 220, 80))
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


async def _seed_dot(session) -> str:
    return await _seed(session, _CIRCLE, "dot")


async def _seed(session, svg: str, subject: str) -> str:
    motif = normalize_motif_svg(svg, id_prefix="seed", render_check=False)
    await store.upsert_motif(
        session,
        motif,
        facets={"subject": subject, "scope": "whole"},
        source="seed",
        status="approved",
    )
    await session.commit()
    return motif.id


def test_import_strips_generator_boilerplate_but_keeps_painting_style():
    # 외부 생성기가 내보내는 SVG는 preserveAspectRatio/style/version/<metadata>를 달고 나와
    # allowlist 거부로 우리 출력물조차 다시 임포트할 수 없었다. 무해한 것만 떼어낸다.
    noisy = (
        '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 100 100"'
        ' preserveAspectRatio="none" style="display: block;">'
        "<metadata><generator-signature>x</generator-signature></metadata>"
        "<title>t</title><desc>d</desc>"
        '<circle cx="50" cy="50" r="30" fill="#ff0000"/></svg>'
    )

    assert (
        normalize_motif_svg(noisy, id_prefix="fixture", render_check=False).id
        == normalize_motif_svg(_CIRCLE, id_prefix="fixture", render_check=False).id
    )

    painting = _CIRCLE.replace('<circle cx="50"', '<circle style="fill:url(#x)" cx="50"')
    try:
        normalize_motif_svg(painting, id_prefix="fixture", render_check=False)
    except ValueError as exc:
        assert "style" in str(exc)
    else:
        raise AssertionError("paint-carrying style must still be rejected")


async def test_motifs_candidates_returns_seeded(client, db_session):
    await _seed_dot(db_session)
    resp = await client.post("/motifs/candidates", json={"query": "dot", "top_k": 5})
    assert resp.status_code == 200
    body = resp.json()
    assert body["registry_version"]
    assert body["candidates"]
    assert body["candidates"][0]["scope"] == "whole"


async def test_motifs_generate_503_when_unconfigured(client):
    # generate는 항상 생성 → GPT Image 미구성이면 무조건 503.
    resp = await client.post("/motifs/generate", json={"query": "novel"})
    assert resp.status_code == 503


async def test_motifs_generate_never_reuses_catalog(app, client, db_session):
    # 카탈로그에 같은 문장의 exact hit가 있어도 재사용하지 않고 새 pending 모티프를 만든다.
    mid = await _seed_dot(db_session)

    class FakeGPTImage:
        calls = 0

        async def generate(self, prompt, *, seed=None):
            FakeGPTImage.calls += 1
            return _generated_png()

    app.state.adapters.gpt_image = FakeGPTImage()
    resp = await client.post("/motifs/generate", json={"query": "dot"})
    assert resp.status_code == 200
    body = resp.json()
    assert FakeGPTImage.calls == 1
    assert body["motif_id"] != mid
    assert set(body) == {"request_id", "motif_id"}


def _lattice_intent(motif_id: str) -> dict:
    return {
        "intent_version": 1,
        "canvas": {"tile_mm": 48, "dpi": 300},
        "seed": 0,
        "production": {"method": "print", "max_colors": 12},
        "palette": {
            "slots": [{"id": "ground", "hex": "#10243a"}, {"id": "accent", "hex": "#ef8a7a"}]
        },
        "colorways": [
            {
                "id": "default",
                "name": "default",
                "mapping": {"ground": "#10243a", "accent": "#ef8a7a"},
            }
        ],
        "layers": [
            {"id": "ground", "type": "background", "z_order": 0, "params": {"color": "ground"}},
            {
                "id": "m0",
                "type": "motif",
                "z_order": 1,
                "params": {"motif_id": motif_id, "size_mm": 6.0},
                "placement": {"type": "lattice", "lattice": {"cell_w_mm": 12.0, "cell_h_mm": 12.0}},
            },
        ],
    }


async def test_generate_renders_with_db_motif_catalog(client, db_session):
    mid = await _seed_dot(db_session)
    resp = await client.post(
        "/generate",
        json={
            "run_id": _RUN_ID,
            "intent": _lattice_intent(mid),
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["design"]["svg"]
    assert body["registry_version"].startswith("0.1.0")


@respx.mock
async def test_prompt_path_end_to_end_with_llm(app, client, db_session):
    mid = await _seed_dot(db_session)
    design = {
        "colors": ["#FFFFFF", "#111111"],
        "ground_color_index": 0,
        "motifs": [{"source": "catalog", "catalog_ref": "catalog_1"}],
        "layers": [
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.12,
                "placement": {
                    "type": "lattice",
                    "columns": 4,
                    "rows": 4,
                    "drop": "none",
                },
            }
        ],
    }
    route = respx.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": json.dumps(design)}}]}
        )
    )
    llm = LLMClient("test-key")
    app.state.adapters.llm = llm
    try:
        resp = await client.post(
            "/generate",
            json={"run_id": _RUN_ID, "prompt": "dot pattern"},
        )
    finally:
        await llm.aclose()
    assert route.call_count == 1
    payload = json.loads(route.calls.last.request.content)
    assert 'User description (JSON string): "dot pattern"' in payload["messages"][-1]["content"]
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # 시드 모티프로 재사용 해석됐는지 — 로그 intent의 motif_id가 치환됐는지 확인
    assert mid in body["design"]["svg"]
    motif_layer = next(layer for layer in body["intent"]["layers"] if layer["type"] == "motif")
    assert motif_layer["params"]["motif_id"] == mid


async def test_prompt_generation_uses_authored_seed_without_override(app, client, db_session):
    mid = await _seed_dot(db_session)
    intent = _lattice_intent(mid)
    intent["seed"] = 37

    class FakeLLM:
        async def author_design(
            self,
            _prompt,
            *,
            validate,
            motif_ids=(),
            **_kwargs,
        ):
            assert motif_ids == []
            assert validate(intent) is None
            return AuthoredDesign(intent=intent)

    app.state.adapters.llm = FakeLLM()

    response = await client.post(
        "/generate",
        json={"run_id": _RUN_ID, "prompt": "seeded dots"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["design"]["seed"] == 37


async def test_motifs_candidates_searches_the_sentence_without_llm(app, client, db_session):
    """후보 검색은 사용자 문장을 그대로 쓰며 LLM 변환에 의존하지 않는다."""
    mid = await _seed_dot(db_session)

    class UnusedLLM:
        async def complete_model(self, *_args, **_kwargs):
            raise AssertionError("candidate search must not call the LLM")

    app.state.adapters.llm = UnusedLLM()
    resp = await client.post("/motifs/candidates", json={"query": "dot", "top_k": 4})
    assert resp.status_code == 200, resp.text
    assert [candidate["motif_id"] for candidate in resp.json()["candidates"]] == [mid]


async def test_motifs_candidates_never_embeds_the_query(app, client, db_session):
    """시트 검색은 lexical 전용 — 임베딩 왕복 없이 답한다(worker-motifs.md §5).

    "결과가 같다"가 아니라 "호출이 없다"를 검사한다. lexical이 우연히 top_k를 채우면
    벡터 다리를 타지 않아, 결과 비교만으로는 회귀를 못 잡는다.
    """
    await _seed_dot(db_session)

    class UnusedEmbedding:
        model = "unused"

        async def embed(self, _text: str):
            raise AssertionError("motif sheet search must not call the embedding provider")

    app.state.adapters.embedding = UnusedEmbedding()
    # lexical이 0건인 질의라야 벡터 다리로 넘어갈 자리가 생긴다 — 이 경우에도 호출이 없어야 한다.
    resp = await client.post("/motifs/candidates", json={"query": "전혀없는것", "top_k": 4})
    assert resp.status_code == 200, resp.text
    assert resp.json()["candidates"] == []


async def test_motifs_candidates_match_a_prefix_but_grounding_does_not(app, client, db_session):
    """prefix 매칭은 시트 전용이다. grounding(`/generate`)의 정확도 게이트는 그대로 둔다."""
    mid = await _seed(db_session, _CIRCLE, "tennis")

    resp = await client.post("/motifs/candidates", json={"query": "테니", "top_k": 4})
    assert resp.status_code == 200, resp.text
    assert [c["motif_id"] for c in resp.json()["candidates"]] == []  # 한글 tag가 없는 fixture

    resp = await client.post("/motifs/candidates", json={"query": "tenn", "top_k": 4})
    assert [c["motif_id"] for c in resp.json()["candidates"]] == [mid]

    # 역방향 — 한국어 복합어는 붙여 써서 한 토큰이 된다("바다동물"). term이 토큰의
    # prefix여도 잡는다.
    resp = await client.post("/motifs/candidates", json={"query": "tennisball", "top_k": 4})
    assert [c["motif_id"] for c in resp.json()["candidates"]] == [mid]

    # 1자 토큰은 prefix 대상이 아니다 — "t"로 카탈로그가 통째로 끌려오면 안 된다.
    resp = await client.post("/motifs/candidates", json={"query": "t", "top_k": 4})
    assert resp.json()["candidates"] == []

    # grounding은 같은 질의에도 prefix로 붙지 않는다 — 저작 모델에 후보를 넘기지 않는다.
    grounded: list[list[str]] = []

    class CapturingLLM:
        async def author_design(self, _prompt, *, validate, motif_ids=(), **_kwargs):
            grounded.append(list(motif_ids))
            intent = _lattice_intent(mid)
            assert validate(intent) is None
            return AuthoredDesign(intent=intent)

    app.state.adapters.llm = CapturingLLM()
    resp = await client.post("/generate", json={"run_id": _RUN_ID, "prompt": "tennisball"})
    assert resp.status_code == 200, resp.text
    assert grounded == [[]]


async def test_motifs_candidates_do_not_reverse_match_a_one_character_term(app, client, db_session):
    """1자 term의 역방향 prefix는 막는다 — "별"이 "별의별"·"별로"를 다 끌어온다."""
    await _seed(db_session, _CIRCLE, "별")

    for query in ("별의별", "별로", "별거아닌"):
        resp = await client.post("/motifs/candidates", json={"query": query, "top_k": 4})
        assert resp.status_code == 200, resp.text
        assert resp.json()["candidates"] == [], query


async def test_motif_slot_replaces_the_layer_without_touching_a_model(client, db_session):
    dot = await _seed_dot(db_session)
    square = await _seed(
        db_session,
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect x="20" y="20" width="60" height="60" fill="#00ff00"/></svg>',
        "square",
    )

    async def activate(slot: int, motif_id: str, run_id: str) -> dict:
        resp = await client.post(
            "/generate",
            json={
                "run_id": run_id,
                "intent": _lattice_intent(dot),
                "motif_slot": {"slot": slot, "motif_id": motif_id},
            },
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    first = await activate(1, square, _RUN_ID)
    layers = [layer for layer in first["intent"]["layers"] if layer["type"] == "motif"]
    assert [layer["params"]["motif_id"] for layer in layers] == [square]
    assert square in first["design"]["svg"]

    # 같은 입력 → byte-identical (모델을 부르지 않는 결정론 재렌더)
    again = await activate(1, square, "22222222-2222-4222-8222-222222222222")
    assert again["design"]["svg"] == first["design"]["svg"]

    # 빈 슬롯 2는 기존 레이어에서 파생 — 같은 격자, 반 칸 엇갈림
    second = await activate(2, square, "33333333-3333-4333-8333-333333333333")
    layers = [layer for layer in second["intent"]["layers"] if layer["type"] == "motif"]
    assert [layer["params"]["motif_id"] for layer in layers] == [dot, square]
    derived = layers[1]["placement"]["lattice"]
    assert (derived["cell_w_mm"], derived["offset_x_mm"], derived["offset_y_mm"]) == (
        12.0,
        6.0,
        6.0,
    )


async def test_motif_slot_requires_the_committed_intent(client):
    resp = await client.post(
        "/generate",
        json={
            "run_id": _RUN_ID,
            "prompt": "dots",
            "motif_slot": {"slot": 1, "motif_id": "seed-1"},
        },
    )
    assert resp.status_code == 422


async def test_motif_slot_creates_the_first_layer_for_a_motifless_design(client, db_session):
    """줄무늬만 있던 디자인도 무늬를 얻을 수 있다 — 기본 격자 한 장으로 시작한다."""
    dot = await _seed_dot(db_session)
    intent = _lattice_intent(dot)
    intent["layers"] = [
        intent["layers"][0],
        {
            "id": "stripe_0",
            "type": "stripe",
            "z_order": 1,
            "params": {
                "angle": 0.0,
                "period_mm": 12.0,
                "bands": [{"offset_mm": 0.0, "width_mm": 4.0, "color": "accent"}],
            },
        },
    ]

    resp = await client.post(
        "/generate",
        json={
            "run_id": _RUN_ID,
            "intent": intent,
            "motif_slot": {"slot": 1, "motif_id": dot},
        },
    )
    assert resp.status_code == 200, resp.text
    layers = [layer for layer in resp.json()["intent"]["layers"] if layer["type"] == "motif"]
    assert [layer["params"]["motif_id"] for layer in layers] == [dot]
    assert layers[0]["placement"]["lattice"]["cell_w_mm"] == 8.0  # tile 48 / 6
    assert dot in resp.json()["design"]["svg"]
