"""Gemini intent 저작 어댑터 (worker-motifs.md §6): prompt → design(intent+motif_specs).

google-genai SDK 대신 httpx로 REST 직접 호출(의존성 최소화): generativelanguage.
googleapis.com v1beta generateContent, response_mime_type=application/json. temperature
0.7. {429,503}만 0.5/1/2s 백오프 최대 4회. designs 파싱은 legacy 단일/bare intent도 수용.

참고 이미지는 검증·방향 보정·축소·메타데이터 제거 후 inline_data로 전달한다.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import math
import re
from dataclasses import dataclass, field
from typing import Literal

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

from worker.adapters import AdapterClientError
from worker.engine.constraints import PaletteConstraint, PatternConstraints, pattern_prompt_lines
from worker.engine.validate import IntentInvalid
from worker.motifs.store import SCOPE_VOCAB, validate_facets

DEFAULT_MODEL = "gemini-2.5-flash-lite"
_BASE_URL = "https://generativelanguage.googleapis.com"
_RETRYABLE = frozenset({429, 503})
_MAX_ATTEMPTS = 4
_BASE_DELAY_S = 0.5
DEFAULT_TILE_MM = 48.0
DEFAULT_DPI = 300
MAX_REFERENCE_IMAGE_PIXELS = 20_000_000
MAX_REFERENCE_IMAGE_SIDE = 2_048


@dataclass(frozen=True)
class AuthoredDesign:
    """한 디자인 해석 — intent JSON + 그와 짝지어진 motif_specs(layer_id로 레이어 매칭)."""

    intent: dict
    motif_specs: list[dict] = field(default_factory=list)


@dataclass(frozen=True)
class ReferenceImage:
    data: bytes
    mime_type: str
    purpose: Literal["auto", "color_mood", "motif", "composition"] = "auto"


def prepare_reference_image(
    data: bytes,
    declared_type: str,
    purpose: Literal["auto", "color_mood", "motif", "composition"] = "auto",
) -> ReferenceImage:
    """검증된 업로드를 Gemini용으로 방향 보정·축소하고 메타데이터를 제거한다."""
    if declared_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError("reference image type is not supported")
    try:
        with Image.open(io.BytesIO(data)) as source:
            if source.width * source.height > MAX_REFERENCE_IMAGE_PIXELS:
                raise ValueError("reference image has too many pixels")
            expected_format = {
                "image/jpeg": "JPEG",
                "image/png": "PNG",
                "image/webp": "WEBP",
            }[declared_type]
            if source.format != expected_format:
                raise ValueError("reference image content does not match its type")
            source.load()
            image = ImageOps.exif_transpose(source).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("reference image could not be decoded") from exc
    image.thumbnail((MAX_REFERENCE_IMAGE_SIDE, MAX_REFERENCE_IMAGE_SIDE), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    # Gemini 입력을 단일 안전 포맷으로 만들고 EXIF/ICC 등 원본 메타데이터를 버린다.
    image.save(output, format="JPEG", quality=88, optimize=True)
    return ReferenceImage(data=output.getvalue(), mime_type="image/jpeg", purpose=purpose)


# ---- 파싱 헬퍼 ----


def _strip_code_fence(text: str) -> str:
    s = text.strip()
    if not s.startswith("```"):
        return s
    match = re.fullmatch(
        r"```[ \t]*(?:[A-Za-z0-9_-]+)?[ \t]*(?:\r?\n)?(?P<body>.*?)```", s, flags=re.DOTALL
    )
    return match.group("body").strip() if match else s


def _split_intent_and_specs(raw: dict) -> tuple[dict, list[dict]]:
    """{"intent":{...},"motif_specs":[...]} 래퍼 또는 bare intent 수용."""
    if isinstance(raw.get("intent"), dict):
        intent = raw["intent"]
        specs = raw.get("motif_specs")
    else:
        intent, specs = raw, None
    if not isinstance(specs, list):
        specs = []
    return intent, [s for s in specs if isinstance(s, dict)]


def _split_designs(raw: dict) -> list[tuple[dict, list[dict]]]:
    """{"designs":[...]} 멀티, legacy 단일 래퍼, bare intent 모두 (intent, specs) 목록으로."""
    designs = raw.get("designs")
    if isinstance(designs, list) and designs:
        out = [_split_intent_and_specs(d) for d in designs if isinstance(d, dict)]
        if out:
            return out
    return [_split_intent_and_specs(raw)]


def _validate_spec_facets(specs: list[dict]) -> list[str]:
    """motif-spec facet 검증 — subject 필수(자유텍스트), scope 필수(통제 어휘)."""
    errors: list[str] = []
    for i, spec in enumerate(specs):
        layer_id = spec.get("layer_id")
        if not isinstance(layer_id, str) or not layer_id:
            errors.append(f"motif_specs[{i}] missing string 'layer_id'")
        if "text" in spec:
            text = spec.get("text")
            if not isinstance(text, str) or not text.strip():
                errors.append(f"motif_specs[{i}] 'text' must be a non-empty string")
            spec.setdefault("subject", "text")
            spec.setdefault("scope", "whole")
            continue
        subject = spec.get("subject")
        if not isinstance(subject, str) or not subject.strip():
            errors.append(f"motif_specs[{i}] missing non-empty 'subject'")
        scope = spec.get("scope")
        if not isinstance(scope, str) or not scope.strip():
            errors.append(f"motif_specs[{i}] missing 'scope' (one of {sorted(SCOPE_VOCAB)})")
            continue
        for fld in ("view", "expression", "style", "description"):
            value = spec.get(fld)
            if value is not None and not isinstance(value, str):
                errors.append(f"motif_specs[{i}] field '{fld}' must be a string")
        try:
            validate_facets(scope)
        except ValueError as exc:
            errors.append(f"motif_specs[{i}]: {exc}")
    return errors


_STRIPE_AXIS_TOL_DEG = 8.0


def normalize_stripes(intent_raw: dict, settings) -> None:
    """프롬프트 경로 stripe 정규화(in place) — 명백한 대각 stripe를 -45°·고정 반복수로.

    period = tile/(k·√2), k = stripe_diagonal_repeats//2, 밴드 offset/width는 비례
    스케일 — 생성 결과가 가는 줄 수십 개 대신 굵은 45° 줄 몇 개가 되게. 축 정렬
    (0/90 ± 8°)은 저작 의도 존중. LLM 경로 전용 — intent 직접
    전달·검증 경로는 건드리지 않는다(프롬프트 문구가 아닌 코드 계약).
    """
    try:
        tile = float(intent_raw["canvas"]["tile_mm"])
        layers = intent_raw["layers"]
    except (KeyError, TypeError, ValueError):
        return
    if not isinstance(layers, list):
        return
    k = max(1, settings.stripe_diagonal_repeats // 2)
    target_period = tile / (k * math.sqrt(2.0))
    for layer in layers:
        if not isinstance(layer, dict) or layer.get("type") != "stripe":
            continue
        params = layer.get("params")
        if not isinstance(params, dict):
            continue
        angle = params.get("angle")
        period = params.get("period_mm")
        bands = params.get("bands")
        if not isinstance(angle, int | float) or not period or not isinstance(bands, list):
            continue
        off_axis = abs(angle) % 90.0
        if min(off_axis, 90.0 - off_axis) <= _STRIPE_AXIS_TOL_DEG:
            continue  # 수직/수평(±톨러런스)은 그대로
        scale = target_period / float(period)
        for band in bands:
            if not isinstance(band, dict):
                continue
            for key in ("offset_mm", "width_mm"):
                if isinstance(band.get(key), int | float):
                    band[key] = round(band[key] * scale, 6)
        params["angle"] = -45.0
        params["period_mm"] = round(target_period, 6)


_EXAMPLE_INTENT = {
    "intent_version": 1,
    "canvas": {"tile_mm": 48, "dpi": 300},
    "seed": 0,
    "production": {"method": "print", "max_colors": 12},
    "palette": {"slots": [{"id": "ground", "hex": "#10243a"}, {"id": "accent", "hex": "#ef8a7a"}]},
    "colorways": [
        {"id": "default", "name": "default", "mapping": {"ground": "#10243a", "accent": "#ef8a7a"}}
    ],
    "layers": [
        {"id": "ground", "type": "background", "z_order": 0, "params": {"color": "ground"}},
        {
            "id": "dots",
            "type": "motif",
            "z_order": 1,
            "params": {"motif_id": "dots", "size_mm": 6.0, "color": "accent"},
            "placement": {"type": "lattice", "lattice": {"cell_w_mm": 12.0, "cell_h_mm": 12.0}},
        },
    ],
}


def _build_prompt(
    user_prompt: str,
    *,
    errors: list[str] | None,
    motif_ids: list[str] | None = None,
    reference_images: list[ReferenceImage] | None = None,
    palette_constraint: PaletteConstraint | None = None,
    pattern_constraints: PatternConstraints | None = None,
) -> str:
    scope_vocab = ", ".join(sorted(SCOPE_VOCAB))
    example = {
        "designs": [
            {
                "intent": _EXAMPLE_INTENT,
                "motif_specs": [
                    {
                        "layer_id": "dots",
                        "subject": "circle",
                        "scope": "whole",
                        "style": "flat",
                        "description": "small solid dot",
                    }
                ],
            }
        ]
    }
    lines = [
        "You convert a textile pattern description into intent JSON for a seamless SVG "
        "engine. The engine handles all geometry, repetition and seamlessness.",
        'Output ONLY one JSON object with a "designs" array. You MUST return 2 to 4 '
        "GENUINELY DIFFERENT designs (vary motif, layout and structure — not just color). "
        'Each entry has two keys "intent" and "motif_specs". No SVG, no coordinates, no '
        "markdown, no prose.",
        "",
        "Valid example (follow the JSON shape; do not copy its pattern):",
        json.dumps(example, ensure_ascii=False, indent=2),
        "",
        "Constraints:",
        "- intent.intent_version must be 1.",
        "- For EACH motif layer, set params.motif_id to that layer's id (a placeholder the "
        "resolver replaces) and add a motif_specs entry whose layer_id equals the layer id. "
        "Do NOT invent registry ids.",
        "- Each motif_specs entry needs: subject (free text, required), scope (REQUIRED, one "
        f"of: {scope_vocab}) — 'whole' for the full subject, 'partial' for a sub-region — "
        "optional view/expression/style, and a short English description for retrieval.",
        "- layer params colors reference palette slot ids, never raw hex.",
        "- a colorway with id 'default' is required; its mapping covers every slot.",
        "- period_mm must divide tile_mm; motif placement spacing_mm must divide tile_mm.",
        "- Placement specs are mandatory: 'lattice' needs cell_w_mm/cell_h_mm; 'scatter' "
        "needs a scatter object; 'path_following' needs host_layer+lane or path plus "
        "spacing_mm.",
        "- Diagonal stripes default to -45 deg with period_mm = tile_mm/sqrt(2).",
        f"- target canvas: {json.dumps({'tile_mm': DEFAULT_TILE_MM, 'dpi': DEFAULT_DPI})}.",
        "- Use at most 2 distinct motif ids in each design (the same motif may appear "
        "in multiple layers).",
        "",
        f"Description: {user_prompt}",
    ]
    if motif_ids:
        lines += [
            "",
            "User-provided SVG motifs (highest priority):",
            f"- Use every one of these exact motif ids in every design: {', '.join(motif_ids)}.",
            "- Do not create motif_specs entries for these exact ids.",
            "- Only use a generated/photo-derived motif if fewer than 2 SVG motif ids "
            "were supplied.",
        ]
    if palette_constraint is not None and palette_constraint.mode == "fixed":
        lines += [
            "",
            "The fixed palette is binding:",
            f"- Use exactly these colors: {', '.join(palette_constraint.colors)}.",
            f"- Declare and reference at least {len(palette_constraint.colors)} distinct palette "
            "slot ids so every requested color appears in rendered geometry.",
            "- The engine deterministically replaces authored colorways with one 'default' "
            "mapping; do not add alternative colorways.",
        ]
    if pattern_constraints is not None:
        constraint_lines = pattern_prompt_lines(pattern_constraints)
        if constraint_lines:
            lines += ["", *constraint_lines]
    if reference_images:
        lines += [
            "",
            f"There are {len(reference_images)} attached photos, in the same order as "
            "the image parts.",
            "The numbered role below is binding. For 'auto' only, infer the best role from "
            "the description. For an explicit role, use that image ONLY for that role and do "
            "not reinterpret it as another kind of reference.",
        ]
        role_instructions = {
            "auto": "infer color/mood, motif form, or composition from the description",
            "color_mood": "use only its palette, lighting, texture impression, and mood",
            "motif": "use only the visible subject's shape as motif inspiration",
            "composition": "use only its spacing, rhythm, arrangement, and composition",
        }
        lines += [
            f"- image {index}: purpose={image.purpose}; {role_instructions[image.purpose]}"
            for index, image in enumerate(reference_images, start=1)
        ]
        lines.append(
            "A photo-inspired motif still needs a motif_specs entry describing the visible subject."
        )
    if errors:
        lines += ["", "Your previous attempt FAILED stage-0 validation. Fix exactly these:"]
        lines += [f"- {e}" for e in errors]
    return "\n".join(lines)


def _build_ideas_prompt(
    prompt: str,
    *,
    count: int,
    reference_images: list[ReferenceImage],
    motifs: list[dict[str, str]],
    palette_constraint: PaletteConstraint,
    pattern_constraints: PatternConstraints,
    errors: list[str] | None = None,
) -> str:
    lines = [
        "Suggest editable prompt drafts for a seamless textile pattern design composer.",
        f'Output ONLY JSON shaped exactly as {{"ideas": [..{count} strings..]}}.',
        f"Return exactly {count} genuinely different ideas. Each idea must be one short, "
        "specific sentence, at most 180 characters, and must not claim that generation "
        "already ran.",
        "Use the same language as the existing prompt; when it is empty, write Korean.",
        f"Existing editable prompt (JSON string): {json.dumps(prompt or '', ensure_ascii=False)}",
    ]
    if reference_images:
        lines += [
            "",
            "Attached photos are numbered in image-part order. Explicit purposes are binding; "
            "only purpose=auto may be interpreted from context.",
            *[
                f"- image {index}: purpose={image.purpose}"
                for index, image in enumerate(reference_images, start=1)
            ],
        ]
    if motifs:
        lines += [
            "",
            "Selected private motifs are exact assets. Use their human names as semantic context, "
            "and do not replace them with invented motifs. Internal content hashes are "
            "deliberately not disclosed to the provider or exposed in the draft.",
            *[
                f"- exact motif {index}: name="
                + json.dumps(motif["name"], ensure_ascii=False)
                for index, motif in enumerate(motifs, start=1)
            ],
        ]
    if palette_constraint.mode == "fixed":
        lines += ["", f"Fixed colors: {', '.join(palette_constraint.colors)}"]
    constraint_lines = pattern_prompt_lines(pattern_constraints)
    if constraint_lines:
        lines += ["", *constraint_lines]
    if errors:
        lines += ["", "The previous response was rejected. Fix these issues:"]
        lines += [f"- {error}" for error in errors]
    return "\n".join(lines)


# ---- 클라이언트 ----


class GeminiClient:
    """generateContent REST 호출 — JSON mode, {429,503} 백오프 재시도."""

    def __init__(
        self, api_key: str, model: str = DEFAULT_MODEL, *, temperature: float = 0.7
    ) -> None:
        if not api_key:
            raise AdapterClientError("GeminiClient requires a non-empty api_key")
        self._api_key = api_key
        self._model = model
        self._temperature = temperature
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        """지연 생성 공유 커넥션 풀 — 재시도·재호출에 재사용, aclose가 닫는다."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=60.0)
        return self._client

    async def complete(
        self, prompt: str, *, reference_images: list[ReferenceImage] | None = None
    ) -> str:
        url = f"{_BASE_URL}/v1beta/models/{self._model}:generateContent"
        parts: list[dict[str, object]] = [
            {
                "inline_data": {
                    "mime_type": image.mime_type,
                    "data": base64.b64encode(image.data).decode("ascii"),
                }
            }
            for image in (reference_images or [])
        ]
        parts.append({"text": prompt})
        body = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "temperature": self._temperature,
                "response_mime_type": "application/json",
            },
        }
        client = self._http()
        resp: httpx.Response | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                resp = await client.post(url, params={"key": self._api_key}, json=body)
            except httpx.HTTPError as exc:
                raise AdapterClientError(f"Gemini request failed: {exc}") from exc
            if resp.status_code in _RETRYABLE and attempt < _MAX_ATTEMPTS - 1:
                await asyncio.sleep(_BASE_DELAY_S * 2**attempt)
                continue
            if resp.status_code >= 400:
                raise AdapterClientError(
                    f"Gemini API error ({resp.status_code}): {resp.text[:500]}"
                )
            break
        assert resp is not None
        try:
            data = resp.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise AdapterClientError(f"Gemini returned an unexpected payload: {exc}") from exc
        if not text:
            raise AdapterClientError("Gemini returned an empty response")
        return text

    async def author_designs(
        self,
        prompt: str,
        *,
        validate=None,
        reference_images: list[ReferenceImage] | None = None,
        motif_ids: list[str] | None = None,
        palette_constraint: PaletteConstraint | None = None,
        pattern_constraints: PatternConstraints | None = None,
    ) -> list[AuthoredDesign]:
        """prompt → 검증 통과 design 목록. facet + (있으면) intent 검증을 통과한 것만 반환.

        전 design 무효면 collected errors를 물려 constrained 재프롬프트 1회, 그래도 무효면
        IntentInvalid(라우트가 422로 매핑). `validate(intent_raw) -> list[str]|None`은
        라우트가 주입(engine validate_intent + 요청 카탈로그) — 어댑터는 엔진에 결합하지 않는다.
        """
        errors: list[str] | None = None
        last_errors: list[str] = ["LLM produced no valid design"]
        for _ in range(2):  # 최초 + constrained 재프롬프트 1회
            text = await self.complete(
                _build_prompt(
                    prompt,
                    errors=errors,
                    motif_ids=motif_ids,
                    reference_images=reference_images,
                    palette_constraint=palette_constraint,
                    pattern_constraints=pattern_constraints,
                ),
                reference_images=reference_images,
            )
            try:
                raw = json.loads(_strip_code_fence(text))
            except (json.JSONDecodeError, TypeError) as exc:
                last_errors = [f"LLM response was not valid JSON: {exc}"]
                errors = last_errors
                continue
            if not isinstance(raw, dict):
                last_errors = ["LLM response JSON was not an object"]
                errors = last_errors
                continue
            results: list[AuthoredDesign] = []
            design_errors: list[str] = []
            for idx, (intent_raw, specs) in enumerate(_split_designs(raw)):
                intent_raw.setdefault("intent_version", 1)
                facet_errors = _validate_spec_facets(specs)
                if facet_errors:
                    design_errors += [f"design[{idx}]: {e}" for e in facet_errors]
                    continue
                if validate is not None:
                    verrs = validate(intent_raw)
                    if verrs:
                        design_errors += [f"design[{idx}]: {e}" for e in verrs]
                        continue
                results.append(AuthoredDesign(intent=intent_raw, motif_specs=specs))
            if results:
                return results
            last_errors = design_errors or ["LLM produced no valid design"]
            errors = last_errors[:6]
        raise IntentInvalid(last_errors)

    async def suggest_ideas(
        self,
        prompt: str,
        *,
        count: Literal[3, 4],
        reference_images: list[ReferenceImage] | None = None,
        motifs: list[dict[str, str]] | None = None,
        palette_constraint: PaletteConstraint | None = None,
        pattern_constraints: PatternConstraints | None = None,
    ) -> list[str]:
        """Return context-aware drafts only; this path never authors or stores an intent."""

        references = reference_images or []
        motif_context = motifs or []
        palette = palette_constraint or PaletteConstraint()
        pattern = pattern_constraints or PatternConstraints()
        errors: list[str] | None = None
        for _ in range(2):
            text = await self.complete(
                _build_ideas_prompt(
                    prompt,
                    count=count,
                    reference_images=references,
                    motifs=motif_context,
                    palette_constraint=palette,
                    pattern_constraints=pattern,
                    errors=errors,
                ),
                reference_images=references,
            )
            try:
                raw = json.loads(_strip_code_fence(text))
            except (json.JSONDecodeError, TypeError) as exc:
                errors = [f"response was not valid JSON: {exc}"]
                continue
            ideas = raw.get("ideas") if isinstance(raw, dict) else None
            if not isinstance(ideas, list):
                errors = ["response must contain an ideas array"]
                continue
            cleaned = [idea.strip() for idea in ideas if isinstance(idea, str) and idea.strip()]
            attempt_errors: list[str] = []
            if len(cleaned) != count:
                attempt_errors.append(f"ideas must contain exactly {count} non-empty strings")
            if any(len(idea) > 180 for idea in cleaned):
                attempt_errors.append("each idea must be at most 180 characters")
            if len({idea.casefold() for idea in cleaned}) != len(cleaned):
                attempt_errors.append("ideas must be distinct")
            if not attempt_errors:
                return cleaned
            errors = attempt_errors
        raise AdapterClientError("Gemini returned invalid idea drafts: " + "; ".join(errors or []))

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()


def build_gemini_client(settings) -> GeminiClient | None:
    api_key = getattr(settings, "gemini_api_key", "")
    if not api_key:
        return None
    model = getattr(settings, "gemini_model", None) or DEFAULT_MODEL
    temperature = getattr(settings, "gemini_temperature", 0.7)
    return GeminiClient(api_key, model, temperature=temperature)
