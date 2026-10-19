"""worker HTTP 요청/응답 계약 (Pydantic). 핸들러·에러 매핑은 api.routes."""

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from worker.motifs.photo_svg import MAX_PROCESSED_PREVIEW_BYTES


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GenerateRequest(StrictRequest):
    """커밋된 intent의 결정론 재렌더 — 템플릿 변형·로고 슬롯 교체. 모델 호출 없음."""

    run_id: uuid.UUID
    # 로그 표식 전용 — admin이 렌더 로그를 요청자·세션 턴과 상관하는 근거.
    session_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    intent: dict[str, Any]
    colorway: str | None = None
    seed: int | None = None
    motif_slot: "MotifSlotInput | None" = None


class MotifSlotInput(StrictRequest):
    # "logo" = 배치형(panel) 포인트 로고 자리 (worker-pipeline.md, set_motif_slot).
    slot: Literal[1, 2, "logo"]
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
    # 배치형 요소 SVG(블레이드 프레임) — 반복 타일 위에 한 번 얹는다. 없으면 null.
    panel_svg: str | None = None


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
    design: DesignOut
    warnings: list[GenerationWarning] = []


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


class PhotoMotifPreviewRequest(StrictRequest):
    image: ReferenceImageInput


class PhotoMotifPreviewResponse(BaseModel):
    svg: str = Field(max_length=2_000_000)
    processed_preview_base64: str = Field(max_length=4 * ((MAX_PROCESSED_PREVIEW_BYTES + 2) // 3))
    background_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list, max_length=5)
