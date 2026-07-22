"""Gemini 디자인 계획 어댑터: prompt → small plan → deterministic intent.

google-genai SDK 대신 httpx로 REST 직접 호출(의존성 최소화): generativelanguage.
googleapis.com v1beta generateContent structured output. temperature 0.7.
{429,503}만 0.5/1/2s 백오프 최대 4회. 모델은 엔진 스키마를 직접 저작하지 않고
작은 DesignPlan만 반환한다. 엔진 intent는 이 모듈이 결정적으로 컴파일한다.

참고 이미지는 검증·방향 보정·축소·메타데이터 제거 후 inline_data로 전달한다.
"""

from __future__ import annotations

import asyncio
import io
import json
import math
import re
from dataclasses import dataclass, field
from typing import Literal

from google import genai
from google.genai import types
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from worker.adapters import AdapterClientError, adapter_http_reason
from worker.engine.constraints import (
    PaletteConstraint,
    PatternConstraints,
    normalize_hex,
    pattern_prompt_lines,
)
from worker.engine.validate import IntentInvalid

DEFAULT_MODEL = "gemini-2.5-flash-lite"
_RETRYABLE = frozenset({429, 503})
_MAX_ATTEMPTS = 4
_BASE_DELAY_S = 0.5
DEFAULT_TILE_MM = 48.0
DEFAULT_DPI = 300
MAX_REFERENCE_IMAGE_PIXELS = 20_000_000
MAX_REFERENCE_IMAGE_SIDE = 2_048
AUTHORING_PROMPT_REVISION = "design-plan-v2-catalog-grounded"


@dataclass(frozen=True)
class AuthoredDesign:
    """한 디자인 해석 — intent JSON + 그와 짝지어진 motif_specs(layer_id로 레이어 매칭)."""

    intent: dict
    motif_specs: list[dict] = field(default_factory=list)
    motif_resolutions: list[dict[str, object]] = field(default_factory=list)


class SemanticMismatch(IntentInvalid):
    """검색 후보가 있는데 model이 grounding 계약을 만족하지 못했다."""


class _CatalogGroundingInvalid(ValueError):
    """검증된 catalog_ref 사용 계약만 위반한 plan."""


@dataclass(frozen=True)
class ReferenceImage:
    data: bytes
    mime_type: str
    purpose: Literal["auto", "color_mood", "motif", "composition"] = "auto"


class PlanMotif(BaseModel):
    """Provider-facing semantic motif; engine IDs and geometry never cross this boundary."""

    model_config = ConfigDict(extra="forbid")

    catalog_ref: str | None = Field(default=None, min_length=1, max_length=40)
    subject: str | None = Field(default=None, min_length=1, max_length=80)
    scope: Literal["whole", "partial"] = "whole"
    style: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=160)
    reference_image_index: int | None = Field(default=None, ge=1, le=5)

    @field_validator("subject")
    @classmethod
    def _strip_subject(cls, value: str | None) -> str | None:
        clean = value.strip() if isinstance(value, str) else value
        return clean or None

    @field_validator("style", "description")
    @classmethod
    def _strip_optional_text(cls, value: str | None) -> str | None:
        clean = value.strip() if isinstance(value, str) else value
        return clean or None

    @model_validator(mode="after")
    def _one_source(self) -> PlanMotif:
        if self.catalog_ref is not None:
            if self.subject is not None or self.reference_image_index is not None:
                raise ValueError("catalog_ref cannot be combined with a semantic motif")
        elif self.subject is None:
            raise ValueError("semantic motif requires subject")
        return self


class DesignPlan(BaseModel):
    """Small structured output contract mapped only to supported engine primitives."""

    model_config = ConfigDict(extra="forbid")

    motifs: list[PlanMotif] = Field(default_factory=list, max_length=2)
    colors: list[str] = Field(min_length=2, max_length=5)
    arrangement: Literal["lattice", "staggered", "scatter"]
    density: Literal["sparse", "medium", "dense"]
    scale: Literal["small", "medium", "large"]
    direction: Literal["horizontal", "vertical", "diagonal"]
    stripes: bool = False

    @field_validator("colors", mode="before")
    @classmethod
    def _normalize_colors(cls, value: object) -> object:
        if not isinstance(value, list):
            return value
        colors: list[str] = []
        for raw in value:
            if not isinstance(raw, str):
                raise ValueError("each color must be a HEX string")
            color = normalize_hex(raw)
            if color not in colors:
                colors.append(color)
        return colors


class DesignPlans(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plans: list[DesignPlan] = Field(min_length=2, max_length=4)


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


_DESIGN_PLAN_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "plans": {
            "type": "ARRAY",
            "minItems": 2,
            "maxItems": 4,
            "items": {
                "type": "OBJECT",
                "properties": {
                    "motifs": {
                        "type": "ARRAY",
                        "maxItems": 2,
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "catalog_ref": {"type": "STRING"},
                                "subject": {"type": "STRING"},
                                "scope": {"type": "STRING", "enum": ["whole", "partial"]},
                                "style": {"type": "STRING"},
                                "description": {"type": "STRING"},
                                "reference_image_index": {"type": "INTEGER"},
                            },
                        },
                    },
                    "colors": {
                        "type": "ARRAY",
                        "minItems": 2,
                        "maxItems": 5,
                        "items": {"type": "STRING"},
                    },
                    "arrangement": {"type": "STRING", "enum": ["lattice", "staggered", "scatter"]},
                    "density": {"type": "STRING", "enum": ["sparse", "medium", "dense"]},
                    "scale": {"type": "STRING", "enum": ["small", "medium", "large"]},
                    "direction": {"type": "STRING", "enum": ["horizontal", "vertical", "diagonal"]},
                    "stripes": {"type": "BOOLEAN"},
                },
                "required": [
                    "motifs",
                    "colors",
                    "arrangement",
                    "density",
                    "scale",
                    "direction",
                    "stripes",
                ],
            },
        }
    },
    "required": ["plans"],
}


def _plan_placement(plan: DesignPlan) -> dict[str, object]:
    axis = {"sparse": 4, "medium": 6, "dense": 8}[plan.density]
    angle = {"horizontal": 0.0, "vertical": 90.0, "diagonal": -45.0}[plan.direction]
    if plan.arrangement == "scatter":
        return {
            "type": "scatter",
            "fixed_rotation_deg": angle,
            "scatter": {
                "mode": "poisson",
                "min_dist_mm": round(DEFAULT_TILE_MM / axis, 6),
                "count": {"sparse": 8, "medium": 16, "dense": 28}[plan.density],
            },
        }
    lattice: dict[str, object] = {
        "cell_w_mm": round(DEFAULT_TILE_MM / axis, 6),
        "cell_h_mm": round(DEFAULT_TILE_MM / axis, 6),
    }
    if plan.arrangement == "staggered":
        lattice.update({"drop_fraction": 0.5, "drop_axis": "column"})
    return {"type": "lattice", "fixed_rotation_deg": angle, "lattice": lattice}


def compile_design_plan(
    plan: DesignPlan,
    *,
    plan_index: int,
    motif_ids: list[str] | None = None,
    catalog_candidates: list[dict[str, object]] | None = None,
    reference_motif_indexes: set[int] | None = None,
    palette_constraint: PaletteConstraint | None = None,
) -> AuthoredDesign:
    """Compile a semantic plan to a schema-valid, tile-commensurate engine intent."""
    exact_ids = list(dict.fromkeys(motif_ids or []))[:2]
    candidate_by_ref = {
        str(candidate["catalog_ref"]): candidate for candidate in (catalog_candidates or [])
    }
    required_references = reference_motif_indexes or set()
    reference_motifs = sorted(
        (
            motif
            for motif in plan.motifs
            if motif.reference_image_index in required_references
        ),
        key=lambda motif: motif.reference_image_index or 0,
    )
    if (
        {motif.reference_image_index for motif in reference_motifs} != required_references
        or len(reference_motifs) != len(required_references)
    ):
        raise ValueError("every motif reference photo must be represented by reference_image_index")

    remaining = max(0, 2 - len(exact_ids) - len(reference_motifs))
    prompt_motifs: list[PlanMotif] = []
    if not exact_ids and remaining > 0:
        prompt_motifs = [
            motif for motif in plan.motifs if motif.reference_image_index is None
        ][:remaining]
        if candidate_by_ref:
            if not prompt_motifs or any(motif.catalog_ref is None for motif in prompt_motifs):
                raise _CatalogGroundingInvalid(
                    "a verified catalog_ref is required for prompt-derived motifs"
                )
        elif any(motif.catalog_ref is not None for motif in prompt_motifs):
            raise ValueError("catalog_ref is not in the verified candidate set")

    motif_sources: list[tuple[str, PlanMotif | None, dict[str, object] | None]] = [
        (
            motif_id,
            None,
            {
                "outcome": "user_exact",
                "motif_id": motif_id,
                "similarity": None,
            },
        )
        for motif_id in exact_ids
    ]
    for semantic in [*reference_motifs, *prompt_motifs]:
        if semantic.catalog_ref is not None:
            candidate = candidate_by_ref.get(semantic.catalog_ref)
            if candidate is None:
                raise _CatalogGroundingInvalid(
                    f"unknown catalog_ref: {semantic.catalog_ref}"
                )
            motif_sources.append(
                (
                    str(candidate["motif_id"]),
                    None,
                    {
                        "outcome": "prompt_catalog",
                        "motif_id": str(candidate["motif_id"]),
                        "subject": candidate.get("subject"),
                        "similarity": candidate.get("similarity"),
                        "match_type": candidate.get("match_type"),
                    },
                )
            )
        else:
            motif_sources.append((f"semantic_{len(motif_sources)}", semantic, None))
    if not motif_sources and not plan.stripes:
        raise ValueError("a plan without exact motifs must include a semantic motif or stripes")

    palette = palette_constraint or PaletteConstraint()
    colors = palette.colors if palette.mode == "fixed" else plan.colors
    slot_ids = ["ground", *[f"color_{index}" for index in range(1, len(colors))]]
    slots = [{"id": slot_id, "hex": color} for slot_id, color in zip(slot_ids, colors, strict=True)]
    mapping = dict(zip(slot_ids, colors, strict=True))
    layers: list[dict[str, object]] = [
        {"id": "ground", "type": "background", "z_order": 0, "params": {"color": "ground"}}
    ]

    # A fixed palette is an output contract: add deterministic bands only when the
    # background + motifs cannot make every requested color visible.
    needs_palette_bands = palette.mode == "fixed" and len(colors) > 1 + len(motif_sources)
    if plan.stripes or needs_palette_bands:
        period = (
            DEFAULT_TILE_MM / math.sqrt(2.0)
            if plan.direction == "diagonal"
            else DEFAULT_TILE_MM / 4
        )
        band_slots = slot_ids[1:] or ["ground"]
        band_width = period / (2 * len(band_slots))
        layers.append(
            {
                "id": "stripes",
                "type": "stripe",
                "z_order": 1,
                "params": {
                    "angle": {"horizontal": 0.0, "vertical": 90.0, "diagonal": -45.0}[
                        plan.direction
                    ],
                    "period_mm": round(period, 6),
                    "bands": [
                        {
                            "offset_mm": round(index * period / len(band_slots), 6),
                            "width_mm": round(band_width, 6),
                            "color": slot_id,
                        }
                        for index, slot_id in enumerate(band_slots)
                    ],
                },
            }
        )

    motif_specs: list[dict] = []
    size_mm = round(DEFAULT_TILE_MM * {"small": 0.10, "medium": 0.18, "large": 0.28}[plan.scale], 6)
    motif_resolutions: list[dict[str, object]] = []
    for index, (motif_id, semantic, resolution) in enumerate(motif_sources):
        layer_id = f"motif_{index}"
        color_id = (
            slot_ids[1 + index] if 1 + index < len(slot_ids) else slot_ids[index % len(slot_ids)]
        )
        layers.append(
            {
                "id": layer_id,
                "type": "motif",
                "z_order": len(layers),
                "params": {"motif_id": motif_id, "size_mm": size_mm, "color": color_id},
                "placement": _plan_placement(plan),
            }
        )
        if semantic is not None:
            motif_specs.append(
                {
                    "layer_id": layer_id,
                    **semantic.model_dump(exclude_none=True, exclude={"catalog_ref"}),
                    "scope": "whole",
                    "required": semantic.reference_image_index is not None,
                }
            )
        if resolution is not None:
            motif_resolutions.append(
                {"layer_id": layer_id, "scope": "whole", **resolution}
            )

    return AuthoredDesign(
        intent={
            "intent_version": 1,
            "canvas": {"tile_mm": DEFAULT_TILE_MM, "dpi": DEFAULT_DPI},
            "seed": (plan_index + 1) * 104729,
            "production": {"method": "print", "max_colors": 12},
            "palette": {"slots": slots},
            "colorways": [{"id": "default", "name": "default", "mapping": mapping}],
            "layers": layers,
        },
        motif_specs=motif_specs,
        motif_resolutions=motif_resolutions,
    )


def _build_prompt(
    user_prompt: str,
    *,
    errors: list[str] | None,
    motif_ids: list[str] | None = None,
    catalog_candidates: list[dict[str, object]] | None = None,
    reference_images: list[ReferenceImage] | None = None,
    palette_constraint: PaletteConstraint | None = None,
    pattern_constraints: PatternConstraints | None = None,
) -> str:
    lines = [
        "Create 2 to 4 genuinely different semantic plans for a seamless textile pattern.",
        "Return only the structured JSON requested by the response schema. Do not write SVG, "
        "engine JSON, coordinates, internal IDs, markdown, or prose.",
        "Each plan chooses 2-5 HEX colors, up to 2 simple visual motifs, arrangement, density, "
        "scale, direction, and whether broad stripes are part of the design.",
        "For a new semantic motif, set subject and write a short English description suitable "
        "for visual retrieval. The engine treats it as one whole isolated object.",
        "",
        f"Description: {user_prompt}",
    ]
    if motif_ids:
        lines += [
            "",
            f"There are {len(motif_ids)} exact private motif assets. They are inserted by the "
            "engine and must remain the highest-priority motifs. Do not guess their IDs and do "
            "not add prompt-derived motifs. Only an explicitly motif-role reference photo may "
            "use a remaining motif slot.",
        ]
    if catalog_candidates:
        lines += [
            "",
            "Verified public catalog motifs are listed below. Prompt-derived motifs MUST use "
            "catalog_ref only; do not combine catalog_ref with subject, style, description, or "
            "reference_image_index. Use at least one catalog_ref while a motif slot remains.",
            *[
                "- "
                + str(candidate["catalog_ref"])
                + ": subject="
                + json.dumps(candidate.get("subject"), ensure_ascii=False)
                + "; description="
                + json.dumps(candidate.get("description"), ensure_ascii=False)
                + "; style="
                + json.dumps(candidate.get("style"), ensure_ascii=False)
                for candidate in catalog_candidates
            ],
        ]
    if palette_constraint is not None and palette_constraint.mode == "fixed":
        lines += [
            "",
            f"The fixed palette is binding: {', '.join(palette_constraint.colors)}.",
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
            "For every image whose purpose is 'motif', include exactly one semantic motif with "
            "subject and the matching 1-based reference_image_index. Do not use catalog_ref for "
            "that photo-derived motif."
        )
    if errors:
        lines += ["", "The previous plan was rejected. Fix these validation issues:"]
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
                f"- exact motif {index}: name=" + json.dumps(motif["name"], ensure_ascii=False)
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
    """Vertex AI generate_content 호출 — ADC 인증, JSON mode."""

    def __init__(
        self,
        project: str,
        model: str = DEFAULT_MODEL,
        *,
        location: str = "global",
        temperature: float = 0.7,
        client: genai.Client | None = None,
    ) -> None:
        if not project and client is None:
            raise AdapterClientError(
                "GeminiClient requires a GCP project",
                provider="gemini",
                operation="generate_content",
                reason_code="not_configured",
            )
        self._model = model
        self._temperature = temperature
        self._client = client or genai.Client(vertexai=True, project=project, location=location)

    async def complete(
        self,
        prompt: str,
        *,
        reference_images: list[ReferenceImage] | None = None,
        response_schema: dict[str, object] | None = None,
    ) -> str:
        parts = [
            types.Part.from_bytes(data=image.data, mime_type=image.mime_type)
            for image in (reference_images or [])
        ]
        parts.append(types.Part.from_text(text=prompt))
        config = types.GenerateContentConfig(
            temperature=self._temperature,
            response_mime_type="application/json",
            response_schema=response_schema,
        )
        response = None
        try:
            for attempt in range(_MAX_ATTEMPTS):
                try:
                    response = await self._client.aio.models.generate_content(
                        model=self._model,
                        contents=[types.Content(role="user", parts=parts)],
                        config=config,
                    )
                    break
                except Exception as exc:
                    status = getattr(exc, "status_code", None)
                    if status in _RETRYABLE and attempt < _MAX_ATTEMPTS - 1:
                        await asyncio.sleep(_BASE_DELAY_S * 2**attempt)
                        continue
                    reason = (
                        adapter_http_reason(status)
                        if isinstance(status, int)
                        else "provider_error"
                    )
                    raise AdapterClientError(
                        f"Gemini request failed: {exc}",
                        provider="gemini",
                        operation="generate_content",
                        reason_code=reason,
                        status_code=status if isinstance(status, int) else None,
                    ) from exc
        except AdapterClientError:
            raise
        except Exception as exc:
            raise AdapterClientError(
                f"Gemini returned an unexpected payload: {exc}",
                provider="gemini",
                operation="generate_content",
                reason_code="invalid_response",
            ) from exc
        if response is None:
            raise AdapterClientError(
                "Gemini returned no response",
                provider="gemini",
                operation="generate_content",
                reason_code="invalid_response",
            )
        text = response.text
        if not text:
            raise AdapterClientError(
                "Gemini returned an empty response",
                provider="gemini",
                operation="generate_content",
                reason_code="invalid_response",
            )
        return text

    async def author_designs(
        self,
        prompt: str,
        *,
        validate=None,
        reference_images: list[ReferenceImage] | None = None,
        motif_ids: list[str] | None = None,
        catalog_candidates: list[dict[str, object]] | None = None,
        palette_constraint: PaletteConstraint | None = None,
        pattern_constraints: PatternConstraints | None = None,
        diagnostics: dict[str, object] | None = None,
    ) -> list[AuthoredDesign]:
        """prompt → structured plans → deterministic, validated engine intents.

        모든 plan이 무효면 오류를 물려 재프롬프트 1회한다. `validate(intent_raw)`는
        라우트가 주입하며, provider는 엔진 스키마나 내부 motif id를 보지 않는다.
        """
        sink = diagnostics if diagnostics is not None else {}
        sink["model"] = self._model
        sink["prompt_revision"] = AUTHORING_PROMPT_REVISION
        errors: list[str] | None = None
        last_errors: list[str] = ["model produced no valid design plan"]
        last_attempt_only_grounding_failures = False
        reference_motif_indexes = {
            index
            for index, image in enumerate(reference_images or [], start=1)
            if image.purpose == "motif"
        }
        for attempt in range(2):
            sink["authoring_attempts"] = attempt + 1
            text = await self.complete(
                _build_prompt(
                    prompt,
                    errors=errors,
                    motif_ids=motif_ids,
                    catalog_candidates=catalog_candidates,
                    reference_images=reference_images,
                    palette_constraint=palette_constraint,
                    pattern_constraints=pattern_constraints,
                ),
                reference_images=reference_images,
                response_schema=_DESIGN_PLAN_SCHEMA,
            )
            try:
                raw = json.loads(_strip_code_fence(text))
                plans = DesignPlans.model_validate(raw).plans
            except (json.JSONDecodeError, TypeError, ValidationError) as exc:
                last_errors = [f"model response did not match DesignPlan: {exc}"]
                last_attempt_only_grounding_failures = False
                errors = last_errors
                continue
            sink["plan_count"] = len(plans)
            results: list[AuthoredDesign] = []
            design_errors: list[str] = []
            grounding_failure_count = 0
            for index, plan in enumerate(plans):
                try:
                    design = compile_design_plan(
                        plan,
                        plan_index=index,
                        motif_ids=motif_ids,
                        catalog_candidates=catalog_candidates,
                        reference_motif_indexes=reference_motif_indexes,
                        palette_constraint=palette_constraint,
                    )
                except _CatalogGroundingInvalid as exc:
                    grounding_failure_count += 1
                    design_errors.append(f"plan[{index}]: {exc}")
                    continue
                except ValueError as exc:
                    design_errors.append(f"plan[{index}]: {exc}")
                    continue
                if validate is not None:
                    verrs = validate(design.intent)
                    if verrs:
                        design_errors += [f"plan[{index}]: {error}" for error in verrs]
                        continue
                results.append(design)
            sink["validated_count"] = len(results)
            if results:
                return results
            last_errors = design_errors or ["model produced no valid design plan"]
            last_attempt_only_grounding_failures = (
                bool(plans) and grounding_failure_count == len(plans)
            )
            errors = last_errors[:6]
        if catalog_candidates and last_attempt_only_grounding_failures:
            raise SemanticMismatch(last_errors)
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
        raise AdapterClientError(
            "Gemini returned invalid idea drafts: " + "; ".join(errors or []),
            provider="gemini",
            operation="suggest_ideas",
            reason_code="invalid_response",
        )

    async def aclose(self) -> None:
        close = getattr(self._client.aio, "aclose", None)
        if close is not None:
            await close()


def build_gemini_client(settings) -> GeminiClient | None:
    project = getattr(settings, "gcp_project_id", "")
    if not project:
        return None
    model = getattr(settings, "gemini_model", None) or DEFAULT_MODEL
    temperature = getattr(settings, "gemini_temperature", 0.7)
    return GeminiClient(
        project,
        model,
        location=getattr(settings, "vertex_ai_location", "global"),
        temperature=temperature,
    )
