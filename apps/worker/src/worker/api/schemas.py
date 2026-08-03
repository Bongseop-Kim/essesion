"""worker HTTP 요청/응답 계약 (Pydantic). 핸들러·에러 매핑은 api.routes."""

import uuid
from typing import Any, Literal

from db.models.seamless import EMBEDDING_DIM
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from worker.authoring.examples import AuthoringFamily
from worker.authoring.promotion import DEFAULT_SCAN_LIMIT
from worker.authoring.schema import DesignPlanV3
from worker.motifs.photo_svg import MAX_PROCESSED_PREVIEW_BYTES
from worker.motifs.text_svg import MAX_TEXT_MOTIF_LENGTH

MAX_MOTIF_QUERY_LENGTH = 200


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


class AuthoringExamplePrepareRequest(StrictRequest):
    retrieval_text: str = Field(min_length=10, max_length=500)
    plan: DesignPlanV3

    @field_validator("retrieval_text", mode="before")
    @classmethod
    def _normalize_retrieval_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class AuthoringExamplePrepareResponse(BaseModel):
    contract_version: int
    family: AuthoringFamily
    motif_count: int
    retrieval_text: str
    tags: list[str]
    plan: dict[str, Any]
    structural_fingerprint: str
    source_digest: str
    embedding_model: str
    embedding: list[float] = Field(min_length=EMBEDDING_DIM, max_length=EMBEDDING_DIM)


class AuthoringExampleEmbeddingModelResponse(BaseModel):
    model: str


class AuthoringCompilePreviewRequest(StrictRequest):
    plan: DesignPlanV3
    motif_ids: list[str] = Field(default_factory=list, max_length=2)
    colorway: str | None = Field(default=None, min_length=1, max_length=100)
    seed: int | None = Field(default=None, ge=-(2**63), le=2**63 - 1)
    tile_mm: float = Field(default=48.0, gt=0.0, le=500.0, allow_inf_nan=False)

    @field_validator("motif_ids")
    @classmethod
    def _distinct_motif_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("motif IDs may not be blank")
        if len(normalized) != len(set(normalized)):
            raise ValueError("motif IDs must be distinct")
        return normalized


class AuthoringCompilePreviewResponse(BaseModel):
    svg: str
    warnings: list[str] = Field(default_factory=list)


class MotifIngressProvenance(StrictRequest):
    user_id: uuid.UUID
    session_id: uuid.UUID | None = None


class ConversationAttachmentRef(StrictRequest):
    filename: str = Field(min_length=1, max_length=255)


class ConversationHistoryItem(StrictRequest):
    user_prompt: str = Field(min_length=1, max_length=4_000)
    assistant_summary: str = Field(min_length=1, max_length=500)
    attachments: list[ConversationAttachmentRef] = Field(default_factory=list, max_length=2)


class ConversationContext(StrictRequest):
    """커밋된 디자인 + 최근 턴 요약. 구성 수정은 intent에 patch를 적용한다 — plan은 필요 없다."""

    current_intent: dict[str, Any]
    history: list[ConversationHistoryItem] = Field(default_factory=list, max_length=6)


class GenerateRequest(StrictRequest):
    run_id: uuid.UUID
    # 로그 표식 전용 — admin이 생성 로그를 요청자·세션 턴과 상관하는 근거.
    # 과금·모티프 유입 provenance가 아니다(그쪽은 모달 경로의 MotifIngressProvenance).
    session_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    prompt: str | None = None
    intent: dict[str, Any] | None = None
    colorway: str | None = None
    seed: int | None = None
    motif_ids: list[str] = Field(default_factory=list, max_length=2)
    conversation_context: ConversationContext | None = None
    # 모티프 슬롯 교체는 intent 재렌더 경로만 쓴다(모델 호출 없음).
    motif_slot: "MotifSlotInput | None" = None

    @model_validator(mode="after")
    def _valid_generation_mode(self) -> "GenerateRequest":
        if self.prompt is not None and not self.prompt.strip():
            self.prompt = None
        if self.intent is not None and (self.prompt is not None or self.motif_ids):
            raise ValueError("intent variation cannot include prompt or motif ids")
        if self.prompt is None and self.intent is None and not self.motif_ids:
            raise ValueError("prompt or SVG motif is required")
        if self.intent is not None and self.conversation_context is not None:
            if self.intent != self.conversation_context.current_intent:
                raise ValueError("direct intent must match the committed conversation intent")
        if self.conversation_context is not None and self.intent is None:
            if self.prompt is None:
                raise ValueError("conversation refinement requires a prompt")
            if self.motif_ids:
                raise ValueError("conversation refinement cannot include motif ids")
        if self.motif_slot is not None and self.intent is None:
            raise ValueError("motif slot replacement requires the committed intent")
        return self


class MotifSlotInput(StrictRequest):
    slot: Literal[1, 2]
    motif_id: str = Field(min_length=1, max_length=100)


class ReferenceImageInput(StrictRequest):
    url: str = Field(max_length=4_000)
    content_type: Literal["image/jpeg", "image/png", "image/webp"]
    size_bytes: int = Field(gt=0, le=10 * 1024 * 1024)


class DesignOut(BaseModel):
    id: str
    layout_id: str
    source_fidelity: str
    colorway_id: str
    seed: int
    svg: str
    png_object_key: str | None


class GenerationWarning(BaseModel):
    """자동 조정 안내 — 코드는 로그·admin용, message는 고객에게 그대로 노출한다."""

    code: str
    message: str


class GenerateResponse(BaseModel):
    generation_log_id: uuid.UUID
    request_id: str
    registry_version: str
    engine_version: str
    intent: dict[str, Any]
    plan: dict[str, Any] | None = None
    structural_fingerprint: str | None = None
    design: DesignOut
    warnings: list[GenerationWarning] = []
    # 구성 patch가 사용자 문장을 어떻게 해석했는지 한 줄 (고객 노출용). 최초 저작은 null.
    note: str | None = None


class ScopeRejectedResponse(BaseModel):
    """구성 patch로 표현할 수 없는 요청 — 아무것도 만들지 않았고 과금도 없다(HTTP 200)."""

    status: Literal["scope_rejected"] = "scope_rejected"


class ExportRequest(StrictRequest):
    svg: str = Field(max_length=2_000_000)
    format: Literal["png", "tiff"] = "png"
    dpi: int = Field(default=300, ge=1)
    width_mm: float = Field(gt=0)
    height_mm: float | None = Field(default=None, gt=0)


class FinalizeTaskRequest(StrictRequest):
    job_id: uuid.UUID


class MotifQuery(StrictRequest):
    """Recraft/검색에 그대로 전달할 문장(C-10: 자유텍스트 길이 제한)."""

    query: str = Field(min_length=1, max_length=MAX_MOTIF_QUERY_LENGTH)


class CandidatesRequest(MotifQuery):
    top_k: int = Field(default=5, ge=1, le=10)


class MotifGenerateRequest(MotifQuery):
    motif_provenance: MotifIngressProvenance | None = None


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
    bbox: tuple[float, float, float, float]
    anchor: tuple[float, float]
    preview_svg: str = Field(max_length=2_000_000)


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
    motif_ids: list[str] = Field(default_factory=list, max_length=2)
    motifs: list[IdeaMotifContext] = Field(default_factory=list, max_length=2)
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
