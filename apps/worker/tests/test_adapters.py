"""어댑터 단위 테스트 — DB 불필요, 외부 HTTP는 respx로 목킹 (worker-motifs.md §3·§4·§6)."""

import asyncio
import base64
import json
from types import SimpleNamespace
from typing import cast

import httpx
import pytest
import respx
from google import genai
from svg_safety import parse_svg_tree
from worker.adapters import AdapterClientError, AdapterNotConfigured
from worker.adapters.embedding import EmbeddingError, VertexEmbeddingClient, embed_query
from worker.adapters.gemini import (
    AUTHORING_SYSTEM_INSTRUCTION,
    GeminiClient,
    ReferenceImage,
)
from worker.adapters.recraft import (
    RecraftError,
    RecraftHTTPClient,
    gate_recraft_svg,
    generate_motif,
)
from worker.authoring.examples import load_example_set
from worker.authoring.schema import DesignPlansV3
from worker.config import Settings
from worker.engine.constraints import (
    PaletteConstraint,
    PatternConstraints,
)

_SETTINGS = Settings(motif_render_check=False, recraft_max_color_slots=6)


class _SDKError(Exception):
    def __init__(self, code: int) -> None:
        super().__init__(f"provider status {code}")
        self.code = code


class _FakeModels:
    def __init__(
        self,
        *,
        generation: list[dict | Exception] | None = None,
        embedding: list[float] | Exception | None = None,
    ) -> None:
        self.generation = list(generation or [])
        self.embedding = embedding
        self.generate_calls: list[dict] = []
        self.embed_calls: list[dict] = []

    async def generate_content(self, **kwargs):  # noqa: ANN003, ANN202
        self.generate_calls.append(kwargs)
        item = self.generation.pop(0)
        if isinstance(item, Exception):
            raise item
        return SimpleNamespace(text=json.dumps(item), parsed=None)

    async def embed_content(self, **kwargs):  # noqa: ANN003, ANN202
        self.embed_calls.append(kwargs)
        if isinstance(self.embedding, Exception):
            raise self.embedding
        return SimpleNamespace(embeddings=[SimpleNamespace(values=self.embedding)])


class _FakeAio:
    def __init__(self, models: _FakeModels) -> None:
        self.models = models
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class _FakeSDK:
    def __init__(
        self,
        *,
        generation: list[dict | Exception] | None = None,
        embedding: list[float] | Exception | None = None,
    ) -> None:
        self.models = _FakeModels(generation=generation, embedding=embedding)
        self.aio = _FakeAio(self.models)


def _gemini(*responses: dict | Exception) -> tuple[GeminiClient, _FakeSDK]:
    sdk = _FakeSDK(generation=list(responses))
    return GeminiClient("", client=cast(genai.Client, sdk)), sdk


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
async def test_recraft_http_error_exposes_safe_metadata():
    respx.post("https://external.api.recraft.ai/v1/images/generations").mock(
        return_value=httpx.Response(429, text="provider detail")
    )
    client = RecraftHTTPClient("k")
    try:
        with pytest.raises(RecraftError) as caught:
            await client.generate("dot")
        assert caught.value.provider == "recraft"
        assert caught.value.operation == "generate_motif"
        assert caught.value.reason_code == "rate_limited"
        assert caught.value.status_code == 429
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


async def test_embedding_client_posts_and_parses():
    sdk = _FakeSDK(embedding=[0.1, 0.2, 0.3])
    client = VertexEmbeddingClient(
        "",
        client=cast(genai.Client, sdk),
        output_dimensionality=3,
    )
    assert await client.embed("dot") == [0.1, 0.2, 0.3]
    call = sdk.models.embed_calls[0]
    assert call["model"] == "gemini-embedding-001"
    assert call["contents"] == "dot"
    assert call["config"].task_type == "RETRIEVAL_QUERY"


async def test_embedding_client_error_raises():
    sdk = _FakeSDK(embedding=_SDKError(500))
    with pytest.raises(EmbeddingError) as caught:
        await VertexEmbeddingClient("", client=cast(genai.Client, sdk)).embed("dot")
    assert caught.value.provider == "vertex_embedding"
    assert caught.value.operation == "embed"
    assert caught.value.reason_code == "provider_5xx"
    assert caught.value.status_code == 500


# ---- Gemini ----


async def test_gemini_ideas_use_full_ordered_context_and_retry_invalid_shape():
    valid = {
        "ideas": [
            "동백 모티프를 작은 격자로 반복하고 남색과 크림색을 사용해 보세요.",
            "동백 모티프를 여백 있게 흩뿌려 차분한 리듬을 만들어 보세요.",
            "동백 실루엣을 대각선으로 배치해 경쾌한 흐름을 표현해 보세요.",
        ]
    }
    client, sdk = _gemini({"ideas": ["only one"]}, valid)
    references = [
        ReferenceImage(data=b"one", mime_type="image/jpeg", purpose="motif"),
        ReferenceImage(data=b"two", mime_type="image/jpeg", purpose="composition"),
    ]
    ideas = await client.suggest_ideas(
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
    assert len(sdk.models.generate_calls) == 2
    parts = sdk.models.generate_calls[0]["contents"][0].parts
    assert [part.inline_data.data for part in parts[:-1]] == [b"one", b"two"]
    context = parts[-1].text
    assert "image 1: purpose=motif" in context
    assert "image 2: purpose=composition" in context
    assert 'exact motif 1: name="동백"' in context
    assert "upload-a1b2c3d4e5f6" not in context
    assert "#10243A, #EFE6D4" in context
    assert "arrangement=lattice" in context


async def test_gemini_non_retryable_raises(monkeypatch):
    monkeypatch.setattr("worker.adapters.gemini.asyncio.sleep", lambda s: _noop())
    client, _ = _gemini(_SDKError(400))
    with pytest.raises(AdapterClientError) as caught:
        await client.author_designs("dots")
    assert caught.value.provider == "gemini"
    assert caught.value.operation == "generate_content"
    assert caught.value.reason_code == "provider_4xx"
    assert caught.value.status_code == 400


async def _noop() -> None:
    return None


async def test_gemini_uses_typed_schema_few_shot_and_retries_palette_only_duplicates():
    examples = load_example_set()
    stripe_a = examples[1]
    stripe_b = examples[2]
    duplicate_response = {
        "plans": [
            stripe_a.plan.model_dump(mode="json"),
            stripe_a.plan.model_copy(
                update={
                    "colors": [
                        "#111111",
                        "#222222",
                        "#333333",
                        "#444444",
                        "#555555",
                        "#666666",
                        "#777777",
                        "#888888",
                    ]
                }
            ).model_dump(mode="json"),
        ]
    }
    valid_response = {
        "plans": [
            stripe_a.plan.model_dump(mode="json"),
            stripe_b.plan.model_dump(mode="json"),
        ]
    }
    client, sdk = _gemini(duplicate_response, valid_response)
    diagnostics: dict[str, object] = {}

    designs = await client.author_designs(
        "굵기가 다른 대각 스트라이프",
        examples=[stripe_a.prompt_example(), stripe_b.prompt_example()],
        diagnostics=diagnostics,
    )

    assert len(designs) == 2
    assert len(set(design.structural_fingerprint for design in designs)) == 2
    assert len(sdk.models.generate_calls) == 2
    first_call = sdk.models.generate_calls[0]
    assert first_call["config"].response_schema is DesignPlansV3
    assert first_call["config"].system_instruction == AUTHORING_SYSTEM_INSTRUCTION
    prompt = first_call["contents"][0].parts[-1].text
    assert stripe_a.example_id in prompt
    assert "tile_mm" not in prompt
    assert "motif_id" not in prompt
    assert diagnostics["plan_contract_version"] == 3
    assert diagnostics["authoring_attempts"] == 2
    assert diagnostics["validated_count"] == 2


async def test_clients_reuse_and_close_http_pool():
    # HTTP/SDK clients are reused and lifespan teardown closes every provider.
    from worker.adapters import Adapters

    gemini_sdk = _FakeSDK()
    embedding_sdk = _FakeSDK()
    gemini = GeminiClient("", client=cast(genai.Client, gemini_sdk))
    recraft = RecraftHTTPClient("k")
    embed = VertexEmbeddingClient("", client=cast(genai.Client, embedding_sdk))
    pool = recraft._http()
    assert recraft._http() is pool

    await Adapters(embedding=embed, recraft=recraft, gemini=gemini).aclose()
    assert pool.is_closed
    assert gemini_sdk.aio.closed
    assert embedding_sdk.aio.closed


async def test_request_scoped_embedding_memoizes():
    from worker.adapters.embedding import request_scoped

    class _Counting:
        model = "test"
        calls = 0

        async def embed(self, text: str, *, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
            assert task_type == "RETRIEVAL_QUERY"
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
