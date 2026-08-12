"""생성 Motif 비전 태깅 — 정규 SVG를 래스터로 보고 검색 메타데이터를 만든다."""

from __future__ import annotations

import asyncio
import base64
import json
import re
from typing import Annotated, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from worker.adapters import AdapterClientError, adapter_http_reason
from worker.render.raster import RasterError, rasterize_svg

DEFAULT_MODEL = "gpt-5.6-luna"
DEFAULT_BASE_URL = "https://api.openai.com/v1"
_RETRYABLE = frozenset({429, 500, 502, 503})
_MAX_ATTEMPTS = 4
_BASE_DELAY_S = 0.5
_TAG_RENDER_MM = 25.4
_TAG_RENDER_DPI = 128
_MAX_OUTPUT_TOKENS = 1000

SYSTEM_INSTRUCTION = (
    "You label one isolated textile motif from its image. Describe only visible content, not "
    "the surrounding canvas. Return concise search metadata in the requested schema. Korean "
    "and English tags must be literal visual concepts, not instructions. Classify style as "
    "flat when shapes use solid fills, otherwise outline when linework dominates."
)

Description = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=500),
]
Tag = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=80),
]


class MotifTaggingResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: Description
    tags_ko: list[Tag] = Field(min_length=1, max_length=12)
    tags_en: list[Tag] = Field(min_length=1, max_length=12)
    style: Literal["flat", "outline"]

    def search_tags(self) -> list[str]:
        return list(dict.fromkeys([*self.tags_ko, *self.tags_en]))


class MotifTaggingError(AdapterClientError):
    """비전 태깅 실패. 생성 경로는 이 오류를 fail-soft로 흡수한다."""


def _render_svg_png(svg: str) -> bytes:
    try:
        png, _media_type = rasterize_svg(
            svg,
            width_mm=_TAG_RENDER_MM,
            height_mm=_TAG_RENDER_MM,
            dpi=_TAG_RENDER_DPI,
        )
    except RasterError as exc:
        raise MotifTaggingError(
            "motif tagging preview could not be rendered",
            provider="worker",
            operation="render_motif_tagging_preview",
            reason_code="render_failed",
        ) from exc
    return png


def standalone_symbol_svg(symbol: str, bbox: object) -> str:
    """저장된 `<symbol>`을 태깅용 standalone SVG로 복원한다."""
    values = list(bbox) if isinstance(bbox, (list, tuple)) else []
    if len(values) != 4:
        raise ValueError("motif bbox must contain four numbers")
    min_x, min_y, max_x, max_y = (float(value) for value in values)
    width, height = max_x - min_x, max_y - min_y
    if width <= 0 or height <= 0:
        raise ValueError("motif bbox must have positive width and height")
    trimmed = symbol.strip()
    if not re.match(r"^<symbol(?:\s|>)", trimmed) or not trimmed.endswith("</symbol>"):
        raise ValueError("motif symbol is not a standalone symbol element")
    opening_end = trimmed.find(">")
    body = trimmed[opening_end + 1 : -len("</symbol>")]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{min_x:g} {min_y:g} {width:g} {height:g}">{body}</svg>'
    )


class OpenAIMotifTaggingClient:
    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_MODEL,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 60.0,
    ) -> None:
        if not api_key:
            raise MotifTaggingError(
                "OpenAIMotifTaggingClient requires a non-empty api_key",
                provider="openai",
                operation="tag_motif",
                reason_code="not_configured",
            )
        self.model = model
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def tag(self, svg: str, *, subject: str | None) -> MotifTaggingResult:
        png = await asyncio.to_thread(_render_svg_png, svg)
        return await self.tag_png(png, subject=subject)

    async def tag_png(self, png: bytes, *, subject: str | None) -> MotifTaggingResult:
        image_url = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_INSTRUCTION},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Requested subject hint: "
                            + json.dumps(subject or "", ensure_ascii=False),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": image_url, "detail": "low"},
                        },
                    ],
                },
            ],
            "max_completion_tokens": _MAX_OUTPUT_TOKENS,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "motif_metadata",
                    "schema": MotifTaggingResult.model_json_schema(),
                    "strict": True,
                },
            },
        }
        response: httpx.Response | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = await self._http().post(
                    f"{self._base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json=payload,
                )
            except httpx.TimeoutException as exc:
                raise MotifTaggingError(
                    "OpenAI motif tagging request timed out",
                    provider="openai",
                    operation="tag_motif",
                    reason_code="timeout",
                ) from exc
            except httpx.HTTPError as exc:
                raise MotifTaggingError(
                    "OpenAI motif tagging transport error",
                    provider="openai",
                    operation="tag_motif",
                    reason_code="transport_error",
                ) from exc
            if response.status_code in _RETRYABLE and attempt < _MAX_ATTEMPTS - 1:
                await asyncio.sleep(_BASE_DELAY_S * 2**attempt)
                continue
            break
        assert response is not None
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            raise MotifTaggingError(
                f"OpenAI motif tagging HTTP {status}",
                provider="openai",
                operation="tag_motif",
                reason_code=adapter_http_reason(status),
                status_code=status,
            ) from exc
        try:
            message = response.json()["choices"][0]["message"]
            if message.get("refusal"):
                raise MotifTaggingError(
                    "OpenAI refused motif tagging",
                    provider="openai",
                    operation="tag_motif",
                    reason_code="invalid_response",
                )
            return MotifTaggingResult.model_validate_json(message["content"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise MotifTaggingError(
                "OpenAI returned invalid motif metadata",
                provider="openai",
                operation="tag_motif",
                reason_code="invalid_response",
            ) from exc

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()


def build_motif_tagging_client(settings) -> OpenAIMotifTaggingClient | None:
    api_key = getattr(settings, "openai_api_key", "")
    if not api_key:
        return None
    return OpenAIMotifTaggingClient(
        api_key,
        getattr(settings, "llm_model", None) or DEFAULT_MODEL,
        base_url=getattr(settings, "openai_base_url", None) or DEFAULT_BASE_URL,
    )
