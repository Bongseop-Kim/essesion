"""worker HTTP 요청/응답 계약 (Pydantic). 핸들러·에러 매핑은 api.routes."""

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from worker.authoring.promotion import DEFAULT_SCAN_LIMIT
from worker.engine.constraints import PaletteConstraint, PatternConstraints
from worker.motifs.photo_svg import MAX_PROCESSED_PREVIEW_BYTES
from worker.motifs.text_svg import MAX_TEXT_MOTIF_LENGTH


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PromotionScanRequest(StrictRequest):
    limit: int = Field(default=DEFAULT_SCAN_LIMIT, ge=1, le=DEFAULT_SCAN_LIMIT)


class PromotionScanResponse(BaseModel):
    scanned: int
    pending: int
    duplicate: int
    invalid: int
    failed: int


class PromotionEmbeddingRequest(StrictRequest):
    candidate_id: uuid.UUID


class PromotionEmbeddingResponse(BaseModel):
    embedding_model: str


class GenerateRequest(StrictRequest):
    prompt: str | None = None
    intent: dict[str, Any] | None = None
    colorway: str | None = None
    seed: int | None = None
    candidate_count: int = Field(default=1, ge=1, le=8)
    reference_images: list["ReferenceImageInput"] = Field(default_factory=list, max_length=5)
    motif_ids: list[str] = Field(default_factory=list, max_length=2)
    palette: PaletteConstraint = Field(default_factory=PaletteConstraint)
    pattern_constraints: PatternConstraints = Field(default_factory=PatternConstraints)

    @model_validator(mode="after")
    def _valid_generation_mode(self) -> "GenerateRequest":
        if self.prompt is not None and not self.prompt.strip():
            self.prompt = None
        if self.intent is not None and (
            self.prompt is not None or self.reference_images or self.motif_ids
        ):
            raise ValueError(
                "intent variation cannot include prompt, reference images, or motif ids"
            )
        if self.prompt is None and self.intent is None and not self.motif_ids:
            raise ValueError("prompt or SVG motif is required")
        motif_references = sum(item.purpose == "motif" for item in self.reference_images)
        if len(self.motif_ids) + motif_references > 2:
            raise ValueError("exact motifs and motif reference photos may use at most 2 slots")
        return self


class ReferenceImageInput(StrictRequest):
    image_id: uuid.UUID
    url: str = Field(max_length=4_000)
    content_type: Literal["image/jpeg", "image/png", "image/webp"]
    size_bytes: int = Field(gt=0, le=10 * 1024 * 1024)
    purpose: Literal["auto", "color_mood", "motif", "composition"] = "auto"


class CandidateOut(BaseModel):
    id: str
    design_index: int
    layout_id: str
    source_fidelity: str
    colorway_id: str
    seed: int
    svg: str
    png_object_key: str | None


class GenerateResponse(BaseModel):
    generation_log_id: uuid.UUID
    request_id: str
    registry_version: str
    engine_version: str
    intents: list[dict[str, Any]]
    candidates: list[CandidateOut]
    warnings: list[str] = []


class ExportRequest(StrictRequest):
    svg: str = Field(max_length=2_000_000)
    format: Literal["png", "tiff"] = "png"
    dpi: int = Field(default=300, ge=1)
    width_mm: float = Field(gt=0)
    height_mm: float | None = Field(default=None, gt=0)


class FinalizeTaskRequest(StrictRequest):
    job_id: uuid.UUID


class MotifSpec(StrictRequest):
    subject: str
    scope: str
    view: str | None = None
    expression: str | None = None
    style: str | None = None
    description: str | None = None


class CandidatesRequest(StrictRequest):
    spec: MotifSpec
    top_k: int = Field(default=5, ge=1, le=10)


class MotifGenerateRequest(StrictRequest):
    spec: MotifSpec
    seed: int | None = None


class MotifImportRequest(StrictRequest):
    svg: str = Field(max_length=2_000_000)

    @field_validator("svg")
    @classmethod
    def _bounded_svg_bytes(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 2_000_000:
            raise ValueError("SVG exceeds 2000000 bytes")
        return value


class MotifImportResponse(BaseModel):
    motif_id: str
    symbol: str = Field(max_length=2_000_000)
    color_slots: list[str] = Field(min_length=1, max_length=6)
    bbox: tuple[float, float, float, float]
    anchor: tuple[float, float]
    preview_svg: str = Field(max_length=2_000_000)


class PaletteExtractRequest(StrictRequest):
    image: ReferenceImageInput
    color_count: int = Field(default=5, ge=2, le=5)


class PaletteExtractResponse(BaseModel):
    colors: list[str] = Field(min_length=2, max_length=5)


class TextMotifPreviewRequest(StrictRequest):
    text: str = Field(min_length=1, max_length=MAX_TEXT_MOTIF_LENGTH)
    font_id: Literal["nanum-gothic", "nanum-myeongjo"]
    font_weight: Literal[400, 700]
    letter_spacing: float = Field(default=0.0, ge=-0.2, le=1.0, allow_inf_nan=False)


class TextMotifPreviewResponse(BaseModel):
    svg: str = Field(max_length=2_000_000)


class PhotoMotifPreviewRequest(StrictRequest):
    image: ReferenceImageInput
    remove_background: bool = True
    simplification: Literal["low", "medium", "high"] = "medium"
    color_count: int = Field(default=4, ge=1, le=6)


class PhotoMotifPreviewResponse(BaseModel):
    svg: str = Field(max_length=2_000_000)
    processed_preview_base64: str = Field(max_length=4 * ((MAX_PROCESSED_PREVIEW_BYTES + 2) // 3))
    background_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list, max_length=5)


class IdeaMotifContext(StrictRequest):
    motif_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)


class IdeasRequest(StrictRequest):
    prompt: str = Field(default="", max_length=4_000)
    reference_images: list[ReferenceImageInput] = Field(default_factory=list, max_length=5)
    motif_ids: list[str] = Field(default_factory=list, max_length=2)
    motifs: list[IdeaMotifContext] = Field(default_factory=list, max_length=2)
    palette: PaletteConstraint = Field(default_factory=PaletteConstraint)
    pattern_constraints: PatternConstraints = Field(default_factory=PatternConstraints)
    count: Literal[3, 4] = 4

    @model_validator(mode="after")
    def _motif_context_matches_ids(self) -> "IdeasRequest":
        contextual_ids = [motif.motif_id for motif in self.motifs]
        if contextual_ids != self.motif_ids:
            raise ValueError("motifs must match motif_ids in the same order")
        if len(contextual_ids) != len(set(contextual_ids)):
            raise ValueError("idea motif context must be distinct")
        return self


class IdeasResponse(BaseModel):
    ideas: list[str] = Field(min_length=3, max_length=4)
