"""어댑터 단위 테스트 — DB 불필요, 외부 HTTP는 respx로 목킹 (worker-motifs.md §3·§4·§6)."""

import asyncio
import base64
import json

import httpx
import pytest
import respx
from worker.adapters import AdapterClientError, AdapterNotConfigured
from worker.adapters.embedding import EmbeddingError, OpenAIEmbeddingClient, embed_query
from worker.adapters.gemini import (
    _DESIGN_PLAN_SCHEMA,
    _DIRECTION_ANGLE_DEG,
    DesignPlan,
    DesignPlans,
    GeminiClient,
    PlanMotif,
    ReferenceImage,
    compile_design_plan,
)
from worker.adapters.recraft import (
    RecraftError,
    RecraftHTTPClient,
    gate_recraft_svg,
    generate_motif,
)
from worker.config import Settings
from worker.engine.constraints import (
    PaletteConstraint,
    PatternConstraints,
    apply_generation_constraints,
    assert_constraints_satisfied,
)
from worker.engine.validate import IntentInvalid, validate_intent
from worker.render.sanitize import parse_svg_tree

_SETTINGS = Settings(motif_render_check=False, recraft_max_color_slots=6)


def _svg(inner: str, viewbox: str = "0 0 100 100") -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}">{inner}</svg>'


def _drawable_count(svg: str) -> int:
    root = parse_svg_tree(svg)
    return sum(
        1
        for el in root.iter()
        if isinstance(el.tag, str)
        and el.tag.rsplit("}", 1)[-1]
        in {"path", "rect", "circle", "ellipse", "polygon", "polyline"}
    )


# ---- Recraft 게이트 (순수 함수) ----


def test_gate_rejects_gradient():
    svg = _svg(
        '<defs><linearGradient id="g"><stop stop-color="#f00"/></linearGradient></defs>'
        '<rect x="0" y="0" width="50" height="50" fill="url(#g)"/>'
    )
    with pytest.raises(ValueError, match="gradient"):
        gate_recraft_svg(svg)


def test_gate_rejects_raster_image():
    with pytest.raises(ValueError, match="raster"):
        gate_recraft_svg(_svg('<image href="x" width="10" height="10"/>'))


def test_gate_converts_rgb_to_hex():
    out = gate_recraft_svg(_svg('<rect x="10" y="10" width="30" height="30" fill="rgb(255,0,0)"/>'))
    assert "#ff0000" in out
    assert "rgb(" not in out


def test_gate_removes_full_canvas_background():
    svg = _svg(
        '<rect x="0" y="0" width="100" height="100" fill="#ffffff"/>'
        '<circle cx="50" cy="50" r="20" fill="#ff0000"/>'
    )
    out = gate_recraft_svg(svg)
    assert _drawable_count(out) == 1  # 배경 rect 제거, circle 유지


def test_gate_passes_clean_svg_unchanged():
    svg = _svg('<path d="M10 10 L60 10 L35 60 Z" fill="#123456"/>')
    assert gate_recraft_svg(svg) == svg  # id 계약 유지


# ---- Recraft generate_motif (재프롬프트·실패) ----


class _FakeRecraft:
    def __init__(self, svgs: list[str]) -> None:
        self._svgs = list(svgs)
        self.calls = 0

    async def generate(self, prompt: str) -> str:
        self.calls += 1
        return self._svgs.pop(0)


_CLEAN = _svg('<circle cx="50" cy="50" r="30" fill="#ff0000"/>')
_GRAD = _svg(
    '<defs><linearGradient id="g"><stop stop-color="#f00"/></linearGradient></defs>'
    '<circle cx="50" cy="50" r="30" fill="url(#g)"/>'
)


async def test_generate_motif_first_try():
    client = _FakeRecraft([_CLEAN])
    motif = await generate_motif(
        {"subject": "dot", "scope": "whole"}, client=client, settings=_SETTINGS
    )
    assert client.calls == 1
    assert motif.id.startswith("recraft-")


async def test_generate_motif_reprompts_once_then_succeeds():
    client = _FakeRecraft([_GRAD, _CLEAN])  # 1차 gradient 거부 → 재프롬프트 → 성공
    motif = await generate_motif(
        {"subject": "dot", "scope": "whole"}, client=client, settings=_SETTINGS
    )
    assert client.calls == 2
    assert motif.id.startswith("recraft-")


async def test_generate_motif_two_failures_raises():
    client = _FakeRecraft([_GRAD, _GRAD])
    with pytest.raises(RecraftError):
        await generate_motif(
            {"subject": "dot", "scope": "whole"}, client=client, settings=_SETTINGS
        )
    assert client.calls == 2


async def test_generate_motif_unconfigured_raises():
    with pytest.raises(AdapterNotConfigured):
        await generate_motif({"subject": "dot", "scope": "whole"}, client=None, settings=_SETTINGS)


@respx.mock
async def test_recraft_http_uses_inline_b64_and_never_fetches_response_url():
    encoded = base64.b64encode(_CLEAN.encode()).decode()
    route = respx.post("https://external.api.recraft.ai/v1/images/generations").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {
                        "b64_json": encoded,
                        "url": "https://attacker.invalid/should-not-be-fetched",
                    }
                ]
            },
        )
    )
    client = RecraftHTTPClient("k")
    try:
        assert await client.generate("dot") == _CLEAN
        payload = json.loads(route.calls.last.request.content)
        assert payload["response_format"] == "b64_json"
        assert len(respx.calls) == 1
    finally:
        await client.aclose()


@respx.mock
async def test_recraft_http_rejects_invalid_base64():
    respx.post("https://external.api.recraft.ai/v1/images/generations").mock(
        return_value=httpx.Response(200, json={"data": [{"b64_json": "not base64!"}]})
    )
    client = RecraftHTTPClient("k")
    try:
        with pytest.raises(RecraftError, match="invalid base64"):
            await client.generate("dot")
    finally:
        await client.aclose()


@respx.mock
async def test_recraft_http_rejects_svg_over_byte_ceiling():
    encoded = base64.b64encode(_CLEAN.encode()).decode()
    respx.post("https://external.api.recraft.ai/v1/images/generations").mock(
        return_value=httpx.Response(200, json={"data": [{"b64_json": encoded}]})
    )
    client = RecraftHTTPClient("k", max_svg_bytes=len(_CLEAN.encode()) - 1)
    try:
        with pytest.raises(RecraftError, match="max_svg_bytes"):
            await client.generate("dot")
    finally:
        await client.aclose()


# ---- 임베딩 ----


async def test_embed_query_none_client_returns_none():
    assert await embed_query("anything", client=None) is None


@respx.mock
async def test_embedding_client_posts_and_parses():
    respx.post("https://api.openai.com/v1/embeddings").mock(
        return_value=httpx.Response(200, json={"data": [{"embedding": [0.1, 0.2, 0.3]}]})
    )
    client = OpenAIEmbeddingClient("sk-test")
    assert await client.embed("dot") == [0.1, 0.2, 0.3]


@respx.mock
async def test_embedding_client_error_raises():
    respx.post("https://api.openai.com/v1/embeddings").mock(return_value=httpx.Response(500))
    with pytest.raises(EmbeddingError):
        await OpenAIEmbeddingClient("sk-test").embed("dot")


# ---- Gemini ----

_VALID_PLANS = {
    "plans": [
        {
            "motifs": [{"subject": "dot", "scope": "whole", "style": "flat"}],
            "colors": ["#10243A", "#EF8A7A"],
            "arrangement": "lattice",
            "density": "medium",
            "scale": "small",
            "direction": "diagonal",
            "stripes": False,
        },
        {
            "motifs": [{"subject": "circle", "scope": "whole"}],
            "colors": ["#F4F0E8", "#334455"],
            "arrangement": "scatter",
            "density": "sparse",
            "scale": "medium",
            "direction": "horizontal",
            "stripes": True,
        },
    ]
}


def _gemini_response(text_obj: dict) -> httpx.Response:
    import json

    return httpx.Response(
        200,
        json={"candidates": [{"content": {"parts": [{"text": json.dumps(text_obj)}]}}]},
    )


@respx.mock
async def test_gemini_retries_on_503_then_succeeds(monkeypatch):
    slept: list[float] = []

    async def _fake_sleep(s: float) -> None:
        slept.append(s)

    monkeypatch.setattr("worker.adapters.gemini.asyncio.sleep", _fake_sleep)
    route = respx.post(url__regex=r".*generateContent").mock(
        side_effect=[
            httpx.Response(503),
            httpx.Response(503),
            _gemini_response(_VALID_PLANS),
        ]
    )
    designs = await GeminiClient("k").author_designs("dots")
    assert route.call_count == 3
    assert slept == [0.5, 1.0]  # 백오프 순서
    assert len(designs) == 2
    assert designs[0].motif_specs[0]["subject"] == "dot"
    payload = json.loads(route.calls.last.request.content)
    assert payload["generationConfig"]["response_schema"]["required"] == ["plans"]


@respx.mock
async def test_gemini_sends_reference_images_before_text_prompt():
    route = respx.post(url__regex=r".*generateContent").mock(
        return_value=_gemini_response(_VALID_PLANS)
    )
    image = ReferenceImage(data=b"safe-jpeg", mime_type="image/jpeg", purpose="composition")
    designs = await GeminiClient("k").author_designs(
        "photo colors",
        reference_images=[image],
        motif_ids=["upload-a1b2c3d4e5f6"],
    )

    assert len(designs) == 2
    payload = json.loads(route.calls.last.request.content)
    parts = payload["contents"][0]["parts"]
    assert parts[0]["inline_data"] == {
        "mime_type": "image/jpeg",
        "data": base64.b64encode(b"safe-jpeg").decode("ascii"),
    }
    assert "attached photos" in parts[-1]["text"]
    assert "image 1: purpose=composition" in parts[-1]["text"]
    assert "ONLY for that role" in parts[-1]["text"]
    assert "1 exact private motif assets" in parts[-1]["text"]
    assert "upload-a1b2c3d4e5f6" not in parts[-1]["text"]


@respx.mock
async def test_gemini_ideas_use_full_ordered_context_and_retry_invalid_shape():
    valid = {
        "ideas": [
            "동백 모티프를 작은 격자로 반복하고 남색과 크림색을 사용해 보세요.",
            "동백 모티프를 여백 있게 흩뿌려 차분한 리듬을 만들어 보세요.",
            "동백 실루엣을 대각선으로 배치해 경쾌한 흐름을 표현해 보세요.",
        ]
    }
    route = respx.post(url__regex=r".*generateContent").mock(
        side_effect=[_gemini_response({"ideas": ["only one"]}), _gemini_response(valid)]
    )
    references = [
        ReferenceImage(data=b"one", mime_type="image/jpeg", purpose="motif"),
        ReferenceImage(data=b"two", mime_type="image/jpeg", purpose="composition"),
    ]
    ideas = await GeminiClient("k").suggest_ideas(
        "차분한 넥타이",
        count=3,
        reference_images=references,
        motifs=[{"motif_id": "upload-a1b2c3d4e5f6", "name": "동백"}],
        palette_constraint=PaletteConstraint(mode="fixed", colors=["#10243A", "#EFE6D4"]),
        pattern_constraints=PatternConstraints(
            motif_scale="small", arrangement="lattice", direction="diagonal"
        ),
    )

    assert ideas == valid["ideas"]
    assert route.call_count == 2
    first_payload = json.loads(route.calls[0].request.content)
    parts = first_payload["contents"][0]["parts"]
    assert [part["inline_data"]["data"] for part in parts[:-1]] == [
        base64.b64encode(b"one").decode("ascii"),
        base64.b64encode(b"two").decode("ascii"),
    ]
    context = parts[-1]["text"]
    assert "image 1: purpose=motif" in context
    assert "image 2: purpose=composition" in context
    assert 'exact motif 1: name="동백"' in context
    assert "upload-a1b2c3d4e5f6" not in context
    assert "#10243A, #EFE6D4" in context
    assert "arrangement=lattice" in context


@respx.mock
async def test_gemini_non_retryable_raises(monkeypatch):
    monkeypatch.setattr("worker.adapters.gemini.asyncio.sleep", lambda s: _noop())
    respx.post(url__regex=r".*generateContent").mock(return_value=httpx.Response(400, text="bad"))
    with pytest.raises(AdapterClientError):
        await GeminiClient("k").author_designs("dots")


async def _noop() -> None:
    return None


@respx.mock
async def test_gemini_reprompts_invalid_plan_shape_and_records_diagnostics():
    route = respx.post(url__regex=r".*generateContent").mock(
        side_effect=[_gemini_response({"plans": []}), _gemini_response(_VALID_PLANS)]
    )
    diagnostics: dict[str, object] = {}
    designs = await GeminiClient("k").author_designs("dots", diagnostics=diagnostics)

    assert len(designs) == 2
    assert route.call_count == 2
    assert diagnostics == {
        "model": "gemini-2.5-flash-lite",
        "authoring_attempts": 2,
        "plan_count": 2,
        "validated_count": 2,
    }


@respx.mock
async def test_gemini_all_invalid_reprompts_then_422(monkeypatch):
    monkeypatch.setattr("worker.adapters.gemini.asyncio.sleep", lambda s: _noop())
    route = respx.post(url__regex=r".*generateContent").mock(
        return_value=_gemini_response(_VALID_PLANS)
    )
    with pytest.raises(IntentInvalid):
        await GeminiClient("k").author_designs("dots", validate=lambda raw: ["forced invalid"])
    assert route.call_count == 2  # 최초 + constrained 재프롬프트 1회


def test_design_plan_schema_matches_pydantic_contract():
    """_DESIGN_PLAN_SCHEMA(프로바이더 응답 스키마)와 DesignPlan Pydantic 제약의 드리프트 가드."""
    plans_schema = _DESIGN_PLAN_SCHEMA["properties"]["plans"]
    plans_model = DesignPlans.model_json_schema()["properties"]["plans"]
    assert plans_schema["minItems"] == plans_model["minItems"]
    assert plans_schema["maxItems"] == plans_model["maxItems"]

    plan_schema = plans_schema["items"]["properties"]
    plan_model = DesignPlan.model_json_schema()["properties"]
    for field in ("arrangement", "density", "scale", "direction"):
        assert plan_schema[field]["enum"] == plan_model[field]["enum"]
    assert plan_schema["direction"]["enum"] == list(_DIRECTION_ANGLE_DEG)
    assert plan_schema["motifs"]["maxItems"] == plan_model["motifs"]["maxItems"]
    assert plan_schema["colors"]["minItems"] == plan_model["colors"]["minItems"]
    assert plan_schema["colors"]["maxItems"] == plan_model["colors"]["maxItems"]

    scope_schema = plan_schema["motifs"]["items"]["properties"]["scope"]
    scope_model = PlanMotif.model_json_schema()["properties"]["scope"]
    assert scope_schema["enum"] == scope_model["enum"]


def test_design_plan_compiler_is_deterministic_and_uses_exact_motifs():
    plan = DesignPlan.model_validate(_VALID_PLANS["plans"][0])
    first = compile_design_plan(plan, plan_index=0, motif_ids=["private-motif"])
    second = compile_design_plan(plan, plan_index=0, motif_ids=["private-motif"])

    assert first == second
    motif_layers = [layer for layer in first.intent["layers"] if layer["type"] == "motif"]
    assert motif_layers[0]["params"]["motif_id"] == "private-motif"
    assert all(spec["layer_id"] != motif_layers[0]["id"] for spec in first.motif_specs)


def test_design_plan_compiler_makes_every_fixed_color_visible():
    plan = DesignPlan.model_validate(_VALID_PLANS["plans"][0])
    design = compile_design_plan(
        plan,
        plan_index=0,
        palette_constraint=PaletteConstraint(
            mode="fixed",
            colors=["#111111", "#333333", "#555555", "#777777", "#999999"],
        ),
    )

    stripe = next(layer for layer in design.intent["layers"] if layer["type"] == "stripe")
    assert {band["color"] for band in stripe["params"]["bands"]} == {
        "color_1",
        "color_2",
        "color_3",
        "color_4",
    }
    constrained = apply_generation_constraints(
        design.intent,
        palette=PaletteConstraint(
            mode="fixed",
            colors=["#111111", "#333333", "#555555", "#777777", "#999999"],
        ),
        pattern=PatternConstraints(
            motif_scale="large",
            density="dense",
            arrangement="staggered",
            direction="diagonal",
        ),
    )
    validated = validate_intent(constrained, repair=True)
    assert_constraints_satisfied(
        validated.intent,
        palette=PaletteConstraint(
            mode="fixed",
            colors=["#111111", "#333333", "#555555", "#777777", "#999999"],
        ),
        pattern=PatternConstraints(
            motif_scale="large",
            density="dense",
            arrangement="staggered",
            direction="diagonal",
        ),
    )


async def test_clients_reuse_and_close_http_pool():
    # 커넥션 풀은 재시도·재호출에 재사용되고, aclose가 실제로 닫는다 (lifespan 배선의 전제).
    from worker.adapters import Adapters

    gemini = GeminiClient("k")
    recraft = RecraftHTTPClient("k")
    embed = OpenAIEmbeddingClient("k")
    pools = [c._http() for c in (gemini, recraft, embed)]
    assert [c._http() for c in (gemini, recraft, embed)] == pools  # 같은 풀 재사용

    await Adapters(embedding=embed, recraft=recraft, gemini=gemini).aclose()
    assert all(pool.is_closed for pool in pools)


def _stripe_intent(angle: float = -36.87) -> dict:
    from .intent_helpers import mvp_intent

    raw = mvp_intent()
    stripe = next(layer for layer in raw["layers"] if layer["type"] == "stripe")
    stripe["params"]["angle"] = angle
    return raw


def _stripe_params(raw: dict) -> dict:
    return next(layer for layer in raw["layers"] if layer["type"] == "stripe")["params"]


def test_normalize_stripes_forces_diagonal_to_minus_45():
    import math

    from worker.adapters.gemini import normalize_stripes

    raw = _stripe_intent(angle=30.0)
    before = _stripe_params(raw)
    old_period = before["period_mm"]
    old_widths = [b["width_mm"] for b in before["bands"]]

    normalize_stripes(raw, _SETTINGS)
    st = _stripe_params(raw)
    tile = raw["canvas"]["tile_mm"]
    assert st["angle"] == -45.0
    assert abs(st["period_mm"] - tile / math.sqrt(2)) < 1e-3  # repeats=2 → k=1
    scale = (tile / math.sqrt(2)) / old_period  # 반올림 전 target으로 스케일 (구현과 동일)
    for got, old in zip([b["width_mm"] for b in st["bands"]], old_widths, strict=True):
        assert abs(got - old * scale) < 1e-5  # 밴드 비례 스케일


@pytest.mark.parametrize("angle", [0.0, 90.0, -90.0, 5.0, 85.0])
def test_normalize_stripes_preserves_axis_aligned(angle):
    from worker.adapters.gemini import normalize_stripes

    raw = _stripe_intent(angle=angle)
    old_period = _stripe_params(raw)["period_mm"]
    normalize_stripes(raw, _SETTINGS)
    st = _stripe_params(raw)
    assert st["angle"] == angle  # 0/90 ± 8° 존중
    assert st["period_mm"] == old_period


def test_normalize_stripes_repeats_controls_k():
    import math

    from worker.adapters.gemini import normalize_stripes

    raw = _stripe_intent(angle=30.0)
    normalize_stripes(raw, Settings(stripe_diagonal_repeats=4))
    st = _stripe_params(raw)
    tile = raw["canvas"]["tile_mm"]
    assert abs(st["period_mm"] - tile / (2 * math.sqrt(2))) < 1e-3  # k=2 → 타일당 4줄


async def test_request_scoped_embedding_memoizes():
    from worker.adapters.embedding import request_scoped

    class _Counting:
        model = "test"
        calls = 0

        async def embed(self, text: str) -> list[float]:
            self.calls += 1
            return [1.0]

    inner = _Counting()
    wrapped = request_scoped(inner)
    assert wrapped is not None
    assert await wrapped.embed("bee") == [1.0]
    assert await wrapped.embed("bee") == [1.0]
    assert await wrapped.embed("dot") == [1.0]
    assert inner.calls == 2  # 같은 텍스트는 1회
    await asyncio.gather(wrapped.embed("ant"), wrapped.embed("ant"))
    assert inner.calls == 3  # 동시 호출도 진행 중 task를 공유해 1회
    assert request_scoped(None) is None  # 미구성은 그대로 통과
