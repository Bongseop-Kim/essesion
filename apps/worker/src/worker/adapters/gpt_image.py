"""GPT Image 2 motif adapter: raster generation -> bounded local VTracer normalization."""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import xml.etree.ElementTree as ET

import httpx
import svg_safety as sanitize
from PIL import Image

from worker.adapters import (
    AdapterClientError,
    AdapterNotConfigured,
    adapter_http_reason,
    log_provider_usage,
)
from worker.motifs.normalize import NormalizedMotif, normalize_motif_svg
from worker.motifs.photo_svg import (
    MAX_VECTOR_SIDE,
    decode_user_image,
    quantize_intermediate_colors,
    remove_flat_border_background,
    threshold_alpha,
    trace_quantized_image,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gpt-image-2"
DEFAULT_QUALITY = "low"
DEFAULT_SIZE = "1024x1024"
DEFAULT_BASE_URL = "https://api.openai.com/v1"
MAX_PNG_BYTES = 10_000_000

_API_PATH = "/images/generations"
_RETRYABLE = frozenset({429, 500, 502, 503})
_MAX_ATTEMPTS = 4
_BASE_DELAY_S = 0.5
_MAX_ERROR_CHARS = 160


class GPTImageError(AdapterClientError):
    """GPT Image request or motif suitability failure."""


def _build_gpt_image_prompt(spec: dict, *, errors: list[str] | None = None) -> str:
    lines = [
        "Create one isolated motif as a clean flat-color illustration.",
        "Place exactly one centered object on a plain pure-white canvas.",
        "Keep at least 10% clear whitespace on every side between the object and canvas edge.",
        "Use crisp flat solid shapes with a clear silhouette and no shadows or shading.",
        "Use as many distinct solid colors as the subject naturally requires; do not limit the "
        "palette.",
        "Do not include text, letters, gradients, patterns, tiles, repetitions, borders, or "
        "background scenery.",
        f"User description: {spec.get('subject')}",
    ]
    if errors:
        lines += ["", "Your previous image was rejected. Fix exactly these:"]
        lines += [f"- {error[:_MAX_ERROR_CHARS]}" for error in errors]
    return "\n".join(lines)


class GPTImageHTTPClient:
    """Minimal async client for the Image API's base64 PNG response."""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = DEFAULT_MODEL,
        quality: str = DEFAULT_QUALITY,
        size: str = DEFAULT_SIZE,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 120.0,
        max_png_bytes: int = MAX_PNG_BYTES,
    ) -> None:
        if not api_key:
            raise GPTImageError(
                "GPTImageHTTPClient requires a non-empty api_key",
                provider="openai_image",
                operation="generate_motif",
                reason_code="not_configured",
            )
        if max_png_bytes < 1:
            raise GPTImageError(
                "GPTImageHTTPClient requires max_png_bytes >= 1",
                provider="openai_image",
                operation="generate_motif",
                reason_code="invalid_configuration",
            )
        self._api_key = api_key
        self._model = model
        self._quality = quality
        self._size = size
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_png_bytes = max_png_bytes
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def generate(self, prompt: str, *, seed: int | None = None) -> bytes:
        # GPT Image has no seed parameter; the resolver interface still passes one.
        del seed
        payload = {
            "model": self._model,
            "prompt": prompt,
            "quality": self._quality,
            "size": self._size,
            "n": 1,
        }
        headers = {"Authorization": f"Bearer {self._api_key}"}

        response: httpx.Response | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = await self._http().post(
                    f"{self._base_url}{_API_PATH}", headers=headers, json=payload
                )
            except httpx.TimeoutException as exc:
                raise GPTImageError(
                    "OpenAI image request timed out",
                    provider="openai_image",
                    operation="generate_motif",
                    reason_code="timeout",
                ) from exc
            except httpx.HTTPError as exc:
                raise GPTImageError(
                    "OpenAI image transport error",
                    provider="openai_image",
                    operation="generate_motif",
                    reason_code="transport_error",
                ) from exc
            status = response.status_code
            if status in _RETRYABLE and attempt < _MAX_ATTEMPTS - 1:
                await asyncio.sleep(_BASE_DELAY_S * 2**attempt)
                continue
            if status >= 400:
                raise GPTImageError(
                    f"OpenAI image API HTTP {status}",
                    provider="openai_image",
                    operation="generate_motif",
                    reason_code=adapter_http_reason(status),
                    status_code=status,
                )
            break
        assert response is not None

        try:
            body = response.json()
            log_provider_usage(
                body,
                provider="openai_image",
                operation="generate_motif",
                model=self._model,
            )
            encoded = body["data"][0]["b64_json"]
            if not isinstance(encoded, str):
                raise ValueError("OpenAI image b64_json must be a string")
            encoded_bytes = encoded.encode("ascii")
            max_encoded_bytes = 4 * ((self._max_png_bytes + 2) // 3)
            if len(encoded_bytes) > max_encoded_bytes:
                raise ValueError(f"OpenAI PNG exceeds {self._max_png_bytes} bytes")
            png = base64.b64decode(encoded_bytes, validate=True)
            if len(png) > self._max_png_bytes:
                raise ValueError(f"OpenAI PNG exceeds {self._max_png_bytes} bytes")
        except (
            KeyError,
            IndexError,
            UnicodeEncodeError,
            binascii.Error,
            TypeError,
            ValueError,
        ) as exc:
            raise GPTImageError(
                "OpenAI image API returned a malformed response",
                provider="openai_image",
                operation="generate_motif",
                reason_code="invalid_response",
            ) from exc
        return png

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()


def build_gpt_image_client(settings) -> GPTImageHTTPClient | None:
    api_key = getattr(settings, "openai_api_key", "")
    if not api_key:
        return None
    return GPTImageHTTPClient(
        api_key,
        base_url=getattr(settings, "openai_base_url", None) or DEFAULT_BASE_URL,
    )


def _preserve_canvas_frame(svg: str) -> str:
    """Keep the generated square canvas as the motif's logical frame after normalization."""
    root = sanitize.parse_svg_tree(svg)
    values = (root.get("viewBox") or "").replace(",", " ").split()
    if len(values) != 4:
        raise ValueError("vectorized SVG needs a four-value viewBox")
    x, y, width, height = values
    root.insert(
        0,
        ET.Element(
            "rect",
            {
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "fill": "none",
                "stroke": "none",
            },
        ),
    )
    return ET.tostring(root, encoding="unicode")


def vectorize_png_motif(
    png: bytes,
    *,
    settings,
) -> NormalizedMotif:
    """Apply the fixed raster-to-vector pipeline to one generated PNG."""
    image = decode_user_image(png, "image/png")
    image.thumbnail((MAX_VECTOR_SIDE, MAX_VECTOR_SIDE), Image.Resampling.LANCZOS)
    image, _confidence = remove_flat_border_background(image)
    image = threshold_alpha(image)
    image = quantize_intermediate_colors(image)
    svg = trace_quantized_image(image)
    svg = _preserve_canvas_frame(svg)
    return normalize_motif_svg(
        svg,
        id_prefix="gpt-image",
        max_aspect_ratio=settings.motif_max_aspect_ratio,
        edge_seam_tol=settings.motif_edge_seam_tol,
        render_check=settings.motif_render_check,
    )


async def generate_motif(
    spec: dict,
    *,
    client,
    settings,
    seed: int | None = None,
) -> NormalizedMotif:
    """Generate and gate one GPT Image motif, with one gate-triggered regeneration."""
    if client is None:
        raise AdapterNotConfigured(
            "no GPT Image client configured (set openai_api_key)",
            provider="openai_image",
            operation="generate_motif",
            reason_code="not_configured",
        )

    errors: list[str] | None = None
    for _ in range(2):
        try:
            png = await client.generate(_build_gpt_image_prompt(spec, errors=errors), seed=seed)
        except GPTImageError:
            raise
        except Exception:
            logger.exception("GPT Image generation failed")
            raise GPTImageError(
                "GPT Image generation failed",
                provider="openai_image",
                operation="generate_motif",
                reason_code="request_failed",
            ) from None
        try:
            return vectorize_png_motif(png, settings=settings)
        except (sanitize.SanitizeError, ValueError) as exc:
            errors = [str(exc)]
    raise GPTImageError(
        "GPT Image motif failed the suitability/sanitize gate after retry",
        provider="openai_image",
        operation="sanitize_motif",
        reason_code="suitability_gate_failed",
    )
