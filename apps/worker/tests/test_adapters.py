"""어댑터 단위 테스트 — DB 불필요, 외부 HTTP는 respx로 목킹 (worker-motifs.md §3·§4·§6)."""

import asyncio

import httpx
import pytest
import respx
from worker.adapters import AdapterClientError, AdapterNotConfigured
from worker.adapters.embedding import EmbeddingError, OpenAIEmbeddingClient, embed_query
from worker.adapters.gemini import GeminiClient
from worker.adapters.recraft import RecraftError, gate_recraft_svg, generate_motif
from worker.config import Settings
from worker.engine.validate import IntentInvalid
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

_VALID_DESIGNS = {
    "designs": [
        {
            "intent": {"intent_version": 1, "canvas": {"tile_mm": 48, "dpi": 300}},
            "motif_specs": [{"layer_id": "m0", "subject": "dot", "scope": "whole"}],
        }
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
            _gemini_response(_VALID_DESIGNS),
        ]
    )
    designs = await GeminiClient("k").author_designs("dots")
    assert route.call_count == 3
    assert slept == [0.5, 1.0]  # 백오프 순서
    assert len(designs) == 1
    assert designs[0].motif_specs[0]["subject"] == "dot"


@respx.mock
async def test_gemini_non_retryable_raises(monkeypatch):
    monkeypatch.setattr("worker.adapters.gemini.asyncio.sleep", lambda s: _noop())
    respx.post(url__regex=r".*generateContent").mock(return_value=httpx.Response(400, text="bad"))
    with pytest.raises(AdapterClientError):
        await GeminiClient("k").author_designs("dots")


async def _noop() -> None:
    return None


@respx.mock
async def test_gemini_parses_legacy_single_wrapper():
    legacy = {
        "intent": {"intent_version": 1, "canvas": {"tile_mm": 48, "dpi": 300}},
        "motif_specs": [{"layer_id": "m0", "subject": "dot", "scope": "whole"}],
    }
    respx.post(url__regex=r".*generateContent").mock(return_value=_gemini_response(legacy))
    designs = await GeminiClient("k").author_designs("dots")
    assert len(designs) == 1


@respx.mock
async def test_gemini_all_invalid_reprompts_then_422(monkeypatch):
    monkeypatch.setattr("worker.adapters.gemini.asyncio.sleep", lambda s: _noop())
    route = respx.post(url__regex=r".*generateContent").mock(
        return_value=_gemini_response(_VALID_DESIGNS)
    )
    with pytest.raises(IntentInvalid):
        await GeminiClient("k").author_designs("dots", validate=lambda raw: ["forced invalid"])
    assert route.call_count == 2  # 최초 + constrained 재프롬프트 1회


async def test_clients_reuse_and_close_http_pool():
    # 커넥션 풀은 재시도·재호출에 재사용되고, aclose가 실제로 닫는다 (lifespan 배선의 전제).
    from worker.adapters import Adapters
    from worker.adapters.recraft import RecraftHTTPClient

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
