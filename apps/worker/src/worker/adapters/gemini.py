"""Gemini intent 저작 어댑터 (worker-motifs.md §6): prompt → design(intent+motif_specs).

google-genai SDK 대신 httpx로 REST 직접 호출(의존성 최소화): generativelanguage.
googleapis.com v1beta generateContent, response_mime_type=application/json. temperature
0.7. {429,503}만 0.5/1/2s 백오프 최대 4회. designs 파싱은 legacy 단일/bare intent도 수용.

이미지 전처리는 이번 범위에서 생략 — `images` 파라미터는 프론트 5단계용 자리만.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field

import httpx

from worker.adapters import AdapterClientError
from worker.engine.validate import IntentInvalid
from worker.motifs.store import SCOPE_VOCAB, validate_facets

DEFAULT_MODEL = "gemini-2.5-flash-lite"
_BASE_URL = "https://generativelanguage.googleapis.com"
_RETRYABLE = frozenset({429, 503})
_MAX_ATTEMPTS = 4
_BASE_DELAY_S = 0.5
DEFAULT_TILE_MM = 48.0
DEFAULT_DPI = 300


@dataclass(frozen=True)
class AuthoredDesign:
    """한 디자인 해석 — intent JSON + 그와 짝지어진 motif_specs(layer_id로 레이어 매칭)."""

    intent: dict
    motif_specs: list[dict] = field(default_factory=list)


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


def _validate_spec_facets(specs: list[dict], image_count: int = 0) -> list[str]:
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


def _build_prompt(user_prompt: str, *, errors: list[str] | None, image_count: int = 0) -> str:
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
        "",
        f"Description: {user_prompt}",
    ]
    if errors:
        lines += ["", "Your previous attempt FAILED stage-0 validation. Fix exactly these:"]
        lines += [f"- {e}" for e in errors]
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

    async def complete(self, prompt: str, *, images: tuple[bytes, ...] = ()) -> str:
        url = f"{_BASE_URL}/v1beta/models/{self._model}:generateContent"
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": self._temperature,
                "response_mime_type": "application/json",
            },
        }
        resp: httpx.Response | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
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
        images: tuple[bytes, ...] = (),
    ) -> list[AuthoredDesign]:
        """prompt → 검증 통과 design 목록. facet + (있으면) intent 검증을 통과한 것만 반환.

        전 design 무효면 collected errors를 물려 constrained 재프롬프트 1회, 그래도 무효면
        IntentInvalid(라우트가 422로 매핑). `validate(intent_raw) -> list[str]|None`은
        라우트가 주입(engine validate_intent + 요청 카탈로그) — 어댑터는 엔진에 결합하지 않는다.
        """
        image_count = len(images)
        errors: list[str] | None = None
        last_errors: list[str] = ["LLM produced no valid design"]
        for _ in range(2):  # 최초 + constrained 재프롬프트 1회
            text = await self.complete(
                _build_prompt(prompt, errors=errors, image_count=image_count), images=images
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
                facet_errors = _validate_spec_facets(specs, image_count)
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

    async def aclose(self) -> None:
        return None


def build_gemini_client(settings) -> GeminiClient | None:
    api_key = getattr(settings, "gemini_api_key", "")
    if not api_key:
        return None
    model = getattr(settings, "gemini_model", None) or DEFAULT_MODEL
    temperature = getattr(settings, "gemini_temperature", 0.7)
    return GeminiClient(api_key, model, temperature=temperature)
