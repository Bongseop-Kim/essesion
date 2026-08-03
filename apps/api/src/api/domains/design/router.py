"""디자인 세션·선택 문맥 — 상태는 api 소유(LangGraph 대체), worker는 stateless.

recraft 예산은 Postgres 공유 카운터(recraft_used) — 인스턴스 수와 무관하게 동작
(ARCHITECTURE §7). finalize 제한은 계정당 24시간 윈도우 쿼터(quota.py) — 세션
카운터·건당 환불 없음. 선택한 intent+plan만 선형 문맥으로 커밋한다.
"""

import asyncio
import base64
import binascii
import json
import logging
import re
import unicodedata
import uuid
from collections.abc import Collection, Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal, cast

from db.models.design import (
    FINALIZE_CANCELED_MESSAGE,
    FINALIZE_DISPATCH_FAILED_MESSAGE,
    DesignSession,
    DesignSessionTurn,
    DesignTurnAttachment,
    GenerationJob,
    UserMotif,
)
from db.models.images import Image
from db.models.seamless import Motif, SeamlessGenerationLog
from fastapi import APIRouter, Query, Request, Response
from obs import request_id_var
from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)
from sqlalchemy import CursorResult, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from svg_safety import SanitizeError, sanitize_svg

from api.db import USER_LOCK, SessionDep, advisory_xact_lock
from api.deps import CurrentUser, SettingsDep, ensure_owner
from api.domains.design.job_lifecycle import (
    CANCELABLE_STATUSES,
    STALE_GENERATION_JOB_AFTER,
    resolve_stale_finalize_jobs,
    stale_finalize_clause,
)
from api.domains.design.quota import (
    acquire_finalize_quota,
    get_finalize_quota,
    load_finalize_limit,
)
from api.domains.images.service import MAX_ORDER_IMAGE_BYTES, order_upload_entity_type
from api.domains.tokens import ledger
from api.errors import ConflictError, DomainError, UpstreamError, WorkerRequestError
from api.integrations.gcs import assets_bucket_name, public_asset_url
from api.schemas import ORMModel, StrictModel

router = APIRouter(tags=["design"])
logger = logging.getLogger(__name__)
MAX_DESIGN_JSON_BYTES = 1_000_000
MAX_DESIGN_PROMPT_LENGTH = 4_000
MAX_DESIGN_MOTIFS = 2
MAX_USER_MOTIFS = 100
MAX_MOTIF_SVG_BYTES = 2_000_000
MAX_TEXT_MOTIF_LENGTH = 20
MAX_PROCESSED_PREVIEW_BYTES = 2_000_000
MAX_PROCESSED_PREVIEW_BASE64_CHARS = 2_666_668
MAX_DESIGN_IDEA_LENGTH = 180
# 모티프 문장(찾기·만들기) 상한 — worker MotifSpec facet 상한과 같게 유지한다.
MAX_MOTIF_QUERY_LENGTH = 100
MOTIF_SEARCH_LIMIT = 4
SIGNED_INT64_MIN = -(2**63)
SIGNED_INT64_MAX = 2**63 - 1


def _bounded_design_json(value: dict[str, Any]) -> dict[str, Any]:
    try:
        size = len(
            json.dumps(
                value,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
        )
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise ValueError("design JSON must be serializable") from exc
    if size > MAX_DESIGN_JSON_BYTES:
        raise ValueError(f"design JSON exceeds {MAX_DESIGN_JSON_BYTES} bytes")
    return value


BoundedDesignJson = Annotated[dict[str, Any], AfterValidator(_bounded_design_json)]
ShortDesignString = Annotated[str, StringConstraints(max_length=100)]
SignedInt64 = Annotated[int, Field(ge=SIGNED_INT64_MIN, le=SIGNED_INT64_MAX)]
DesignIdea = Annotated[str, StringConstraints(max_length=MAX_DESIGN_IDEA_LENGTH)]


class FinalizeQuotaOut(BaseModel):
    """계정당 24시간 실사화 쿼터 — reset_at은 슬롯이 하나 풀리는 시각(카운트 0이면 null)."""

    limit: int
    used: int
    remaining: int
    reset_at: datetime | None


class CurrentMotifOut(BaseModel):
    """현재 디자인이 쓰고 있는 모티프 슬롯 — 좌측 패널이 썸네일·이름으로 표시한다."""

    motif_id: str
    name: str | None
    preview_svg: str


class DesignSessionOut(ORMModel):
    id: uuid.UUID
    status: str
    seed: int | None
    colorway: str | None
    registry_version: str | None
    current_intent: dict[str, Any] | None
    current_plan: dict[str, Any] | None
    context_version: int
    active_generation_id: uuid.UUID | None
    active_generation_started_at: datetime | None
    recraft_used: int
    created_at: datetime
    updated_at: datetime
    # 목록 전용 — 마지막 generate_request 턴의 프롬프트 (세션 구분용 요약)
    last_prompt: str | None = None
    # 단건 GET 전용 — 계정 쿼터 (목록은 null, 설정 부재 시에도 null)
    finalize_quota: FinalizeQuotaOut | None = None
    # 단건 GET·스텝 이동 전용 — 남은 모티프 생성 횟수(예산 - recraft_used). 목록은 null.
    # 상한은 서버 설정이라 프론트가 계산할 수 없다 — 유료 행의 "N번 더 가능"이 이 값을 쓴다.
    recraft_remaining: int | None = None
    # 단건 GET·스텝 이동 전용 — current_intent의 모티프 슬롯(최대 2). 목록은 빈 배열.
    current_motifs: list[CurrentMotifOut] = Field(default_factory=list)


class DesignTurnOut(ORMModel):
    id: uuid.UUID
    seq: int
    role: str
    payload: dict[str, Any]
    created_at: datetime
    attachments: list["DesignTurnAttachmentOut"] = Field(default_factory=list)


class DesignTurnAttachmentOut(BaseModel):
    filename: str
    preview_svg: str


class UserMotifImportRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    svg: str = Field(max_length=MAX_MOTIF_SVG_BYTES)

    @field_validator("svg")
    @classmethod
    def _bounded_svg_bytes(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_MOTIF_SVG_BYTES:
            raise ValueError(f"SVG exceeds {MAX_MOTIF_SVG_BYTES} bytes")
        return value


class WorkerMotifImportOut(BaseModel):
    motif_id: str = Field(pattern=r"^upload-[0-9a-f]{12}$")
    symbol: str = Field(max_length=MAX_MOTIF_SVG_BYTES)
    color_slots: list[str] = Field(min_length=1, max_length=6)
    bbox: tuple[float, float, float, float]
    anchor: tuple[float, float]
    preview_svg: str = Field(max_length=MAX_MOTIF_SVG_BYTES)

    @field_validator("symbol")
    @classmethod
    def _safe_symbol(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_MOTIF_SVG_BYTES:
            raise ValueError(f"SVG exceeds {MAX_MOTIF_SVG_BYTES} bytes")
        try:
            sanitize_svg(value)
        except SanitizeError as exc:
            raise ValueError("worker returned unsafe motif symbol") from exc
        return value

    @field_validator("color_slots")
    @classmethod
    def _ordered_color_slots(cls, values: list[str]) -> list[str]:
        if values != [f"s{index}" for index in range(len(values))]:
            raise ValueError("motif color slots must be ordered s0..sN")
        return values

    @field_validator("bbox")
    @classmethod
    def _unit_bbox(cls, value: tuple[float, float, float, float]):
        if value != (-0.5, -0.5, 0.5, 0.5):
            raise ValueError("motif bbox must use the normalized unit frame")
        return value

    @field_validator("anchor")
    @classmethod
    def _origin_anchor(cls, value: tuple[float, float]):
        if value != (0.0, 0.0):
            raise ValueError("motif anchor must use the normalized origin")
        return value

    @field_validator("preview_svg")
    @classmethod
    def _safe_preview_svg(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_MOTIF_SVG_BYTES:
            raise ValueError(f"SVG exceeds {MAX_MOTIF_SVG_BYTES} bytes")
        try:
            return sanitize_svg(value)
        except SanitizeError as exc:
            raise ValueError("worker returned unsafe motif preview") from exc


class UserMotifOut(BaseModel):
    id: uuid.UUID
    motif_id: str
    name: str
    preview_svg: str
    created_at: datetime


def _normalize_hex(value: str) -> str:
    value = value.strip().upper()
    if re.fullmatch(r"#[0-9A-F]{3}", value):
        value = "#" + "".join(character * 2 for character in value[1:])
    if not re.fullmatch(r"#[0-9A-F]{6}", value):
        raise ValueError("colors must be #RGB or #RRGGBB")
    return value


class PaletteConstraint(StrictModel):
    mode: Literal["auto", "fixed"] = "auto"
    colors: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("colors")
    @classmethod
    def _normalize_colors(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(_normalize_hex(value) for value in values))

    @model_validator(mode="after")
    def _valid_mode(self) -> "PaletteConstraint":
        if self.mode == "auto" and self.colors:
            raise ValueError("auto palette cannot include colors")
        if self.mode == "fixed" and not 2 <= len(self.colors) <= 5:
            raise ValueError("fixed palette requires 2 to 5 distinct colors")
        return self


class PaletteExtractRequest(StrictModel):
    upload_id: uuid.UUID
    color_count: int = Field(5, ge=2, le=5)


class PaletteExtractOut(BaseModel):
    colors: list[str] = Field(min_length=2, max_length=5)

    @field_validator("colors")
    @classmethod
    def _normalize_colors(cls, values: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(_normalize_hex(value) for value in values))
        if not 2 <= len(normalized) <= 5:
            raise ValueError("palette extraction must return 2 to 5 distinct colors")
        return normalized


class TextMotifPreviewRequest(StrictModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_MOTIF_LENGTH)
    font_id: Literal["nanum-gothic", "nanum-myeongjo"] = "nanum-gothic"
    font_weight: Literal[400, 700] = 400
    letter_spacing: float = Field(0, ge=-0.2, le=1.0)

    @field_validator("text")
    @classmethod
    def _normalize_text(cls, value: str) -> str:
        value = unicodedata.normalize("NFC", value).strip()
        if not value or len(value) > MAX_TEXT_MOTIF_LENGTH:
            raise ValueError("text motif must contain 1 to 20 characters")
        if any(not _is_supported_text_motif_character(character) for character in value):
            raise ValueError("text motif supports Korean, English, numbers, and spaces only")
        return value


def _is_supported_text_motif_character(character: str) -> bool:
    return (
        character == " "
        or "A" <= character <= "Z"
        or "a" <= character <= "z"
        or "0" <= character <= "9"
        or "\uac00" <= character <= "\ud7a3"
        or "\u3131" <= character <= "\u318e"
    )


class PhotoMotifPreviewRequest(StrictModel):
    upload_id: uuid.UUID
    remove_background: bool = True
    simplification: Literal["low", "medium", "high"] = "medium"
    color_count: int = Field(4, ge=1, le=6)


class MotifPreviewOut(BaseModel):
    svg: str = Field(max_length=MAX_MOTIF_SVG_BYTES)
    warnings: list[str] = Field(default_factory=list)
    background_confidence: float | None = Field(default=None, ge=0, le=1)
    processed_preview_base64: str | None = Field(
        default=None,
        max_length=MAX_PROCESSED_PREVIEW_BASE64_CHARS,
    )

    @field_validator("svg")
    @classmethod
    def _safe_svg(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_MOTIF_SVG_BYTES:
            raise ValueError(f"SVG exceeds {MAX_MOTIF_SVG_BYTES} bytes")
        try:
            return sanitize_svg(value)
        except SanitizeError as exc:
            raise ValueError("worker returned unsafe SVG") from exc

    @field_validator("processed_preview_base64")
    @classmethod
    def _safe_processed_preview(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            decoded = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("processed preview must be valid base64") from exc
        if len(decoded) > MAX_PROCESSED_PREVIEW_BYTES or not decoded.startswith(
            b"\x89PNG\r\n\x1a\n"
        ):
            raise ValueError("processed preview must be a bounded PNG")
        return value


class DesignIdeasRequest(StrictModel):
    prompt: str = Field("", max_length=MAX_DESIGN_PROMPT_LENGTH)
    user_motif_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_DESIGN_MOTIFS)
    palette: PaletteConstraint = Field(default_factory=PaletteConstraint)
    count: Literal[3, 4] = 4

    @model_validator(mode="after")
    def _valid_context(self) -> "DesignIdeasRequest":
        self.prompt = self.prompt.strip()
        if len(set(self.user_motif_ids)) != len(self.user_motif_ids):
            raise ValueError("user motifs must be distinct")
        return self


class DesignIdeasOut(BaseModel):
    ideas: list[DesignIdea] = Field(min_length=3, max_length=4)

    @field_validator("ideas")
    @classmethod
    def _valid_ideas(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value or len(value) > MAX_DESIGN_IDEA_LENGTH for value in normalized):
            raise ValueError(
                f"ideas must be non-empty and at most {MAX_DESIGN_IDEA_LENGTH} characters"
            )
        if len(set(normalized)) != len(normalized):
            raise ValueError("ideas must be distinct")
        return normalized


class DesignOut(BaseModel):
    id: str
    layout_id: str
    source_fidelity: str
    colorway_id: str
    seed: int
    svg: str
    png_object_key: str | None


class DesignGenerateRequest(StrictModel):
    session_id: uuid.UUID
    prompt: str | None = Field(default=None, max_length=MAX_DESIGN_PROMPT_LENGTH)
    colorway: str | None = Field(default=None, max_length=100)
    seed: SignedInt64 | None = None
    user_motif_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_DESIGN_MOTIFS)
    palette: PaletteConstraint = Field(default_factory=PaletteConstraint)

    @model_validator(mode="after")
    def _valid_attachment_request(self) -> "DesignGenerateRequest":
        if len(set(self.user_motif_ids)) != len(self.user_motif_ids):
            raise ValueError("user motifs must be distinct")
        if self.prompt is not None and not self.prompt.strip():
            self.prompt = None
        if self.prompt is None and not self.user_motif_ids:
            raise ValueError("prompt or SVG motif is required")
        return self


class DesignWarningOut(BaseModel):
    """자동 조정 안내 — message는 그대로 노출한다(상단 알림, 노랑 톤)."""

    code: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=200)


class DesignGenerateOut(BaseModel):
    run_id: uuid.UUID
    request_id: str
    registry_version: str
    engine_version: str
    design: DesignOut
    warnings: list[DesignWarningOut] = []
    # 입력창 문장을 어떻게 해석했는지 한 줄. 최초 생성은 null.
    note: str | None = None


class DesignGenerateRejectedOut(BaseModel):
    """구성 수정으로 표현할 수 없는 요청 — 토큰 미사용, 턴 미생성, 상단 알림만(빨강 톤)."""

    rejected: Literal["motif"]


class WorkerDesignOut(DesignOut):
    intent: dict[str, Any] | None = None


class WorkerDesignGenerateOut(BaseModel):
    generation_log_id: uuid.UUID
    request_id: str
    registry_version: str
    engine_version: str
    intent: dict[str, Any]
    plan: dict[str, Any] | None = None
    structural_fingerprint: str | None = None
    design: WorkerDesignOut
    warnings: list[DesignWarningOut] = Field(default_factory=list)
    note: str | None = Field(default=None, max_length=200)


class DesignStepActivateRequest(StrictModel):
    run_id: uuid.UUID


class DesignTurnAttachmentRefPayload(StrictModel):
    filename: str = Field(min_length=1, max_length=255)


class DesignUserGenerationPayload(StrictModel):
    type: Literal["generate_request"] = "generate_request"
    run_id: uuid.UUID
    mode: Literal["prompt"]
    prompt: str | None = Field(default=None, max_length=MAX_DESIGN_PROMPT_LENGTH)
    seed: SignedInt64 | None = None
    colorway: str | None = Field(default=None, max_length=100)
    palette: PaletteConstraint
    attachment_refs: list[DesignTurnAttachmentRefPayload] = Field(
        default_factory=list,
        max_length=MAX_DESIGN_MOTIFS,
    )


class DesignAssistantErrorPayload(StrictModel):
    stage: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=100)


class DesignAssistantGenerationPayload(StrictModel):
    type: Literal["generate"] = "generate"
    run_id: uuid.UUID
    status: Literal["succeeded", "error"]
    summary: str | None = Field(default=None, min_length=1, max_length=500)
    error: DesignAssistantErrorPayload | None = None

    @model_validator(mode="after")
    def _status_shape(self) -> "DesignAssistantGenerationPayload":
        if self.status == "succeeded" and self.error is not None:
            raise ValueError("successful assistant turns cannot contain an error")
        if self.status == "error" and self.error is None:
            raise ValueError("error assistant turns require a stage and code")
        return self


class DesignStepActivateTurnPayload(StrictModel):
    type: Literal["activate"] = "activate"
    run_id: uuid.UUID
    seed: SignedInt64
    colorway_id: str = Field(min_length=1, max_length=100)


class DesignMotifActivateTurnPayload(StrictModel):
    """모티프 슬롯 교체 요청 턴 — 문장이 없으므로 구성 수정의 대화 문맥에는 들어가지 않는다."""

    type: Literal["motif_activate"] = "motif_activate"
    run_id: uuid.UUID
    slot: Literal[1, 2]
    motif_id: str = Field(min_length=1, max_length=100)


@dataclass(frozen=True)
class _ResolvedDesignRun:
    log: SeamlessGenerationLog
    intent: dict[str, Any]
    # 최초 저작 런만 plan을 남긴다. 구성 patch 런은 None.
    plan: dict[str, Any] | None
    seed: int
    colorway_id: str


class DesignFinalizeTurnPayload(StrictModel):
    type: Literal["finalize"] = "finalize"
    job_id: uuid.UUID
    production_method: str = Field(min_length=1, max_length=100)
    weave: str = Field(min_length=1, max_length=100)


class DesignTurnCreateRequest(StrictModel):
    """Only UI-only finalize annotations remain client-authored.

    Generation results and candidate selections mutate session memory, so their
    turns are emitted exclusively by the corresponding server actions.
    """

    role: Literal["user"]
    payload: DesignFinalizeTurnPayload


class DesignExportRequest(BaseModel):
    """SVG → PNG/TIFF 형식 변환 — 이미 생성된 디자인의 재출력이라 토큰 과금 없음.

    dpi·치수 상한은 워커가 최종 권위(WorkerRequestError로 detail 전파) — 여기서
    중복 선언하면 KNOWN_WEAVES처럼 드리프트 위험이라 구조 검증만 한다.
    """

    session_id: uuid.UUID | None = None  # 있으면 소유자 확인
    svg: str = Field(max_length=2_000_000)
    format: Literal["png", "tiff"] = "png"
    dpi: int = Field(300, ge=1)
    width_mm: float = Field(gt=0)
    height_mm: float | None = Field(None, gt=0)


# 워커 에셋(assets/fabric/*.png) stem과 일치해야 하는 얕은 사전검증용 상수 —
# 잘못된 weave가 finalize 예산을 태우기 전에 400으로 거른다(worker는 최종 권위).
KNOWN_WEAVES = ("check", "herringbone", "jacquard", "pindot", "solid", "twill-0", "twill-45")


class FinalizeRequest(BaseModel):
    intent: BoundedDesignJson | None = None
    run_id: uuid.UUID | None = None
    colorway_id: str | None = Field(default=None, max_length=100)
    production_method: str | None = Field(default=None, max_length=100)
    dpi: int | None = None
    weave: str | None = Field(default=None, max_length=100)
    material_map: dict[ShortDesignString, ShortDesignString] | None = Field(
        default=None, max_length=100
    )
    texture_strength: float | None = Field(None, ge=0)
    relief_strength: float | None = Field(None, ge=0)


class GenerationJobOut(ORMModel):
    id: uuid.UUID
    session_id: uuid.UUID | None
    kind: str
    status: str
    params: dict[str, Any]
    result: dict[str, Any] | None
    result_url: str | None
    error_message: str | None
    request_id: str | None
    attempts: int
    created_at: datetime
    updated_at: datetime


class DesignOrderReferenceOut(BaseModel):
    object_key: str
    upload_id: uuid.UUID | None = None


def _motif_preview_svg(motif: Motif) -> str:
    try:
        symbol = sanitize_svg(motif.symbol)
    except SanitizeError as exc:
        raise DomainError("모티프 SVG가 안전하지 않습니다", code="unsafe_motif_svg") from exc
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.6 -0.6 1.2 1.2" '
        'preserveAspectRatio="xMidYMid meet">'
        f"<defs>{symbol}</defs>"
        f'<use href="#motif-{motif.id}" color="#111111"/>'
        "</svg>"
    )


def _user_motif_out(link: UserMotif, motif: Motif) -> UserMotifOut:
    return UserMotifOut(
        id=link.id,
        motif_id=motif.id,
        name=link.name,
        preview_svg=_motif_preview_svg(motif),
        created_at=link.created_at,
    )


async def _design_session_out(
    session: SessionDep,
    design_session: DesignSession,
    recraft_budget: int,
) -> DesignSessionOut:
    """세션 응답 + 현재 디자인의 모티프 슬롯(카탈로그 포함, 최대 2) + 남은 생성 횟수."""

    out = DesignSessionOut.model_validate(design_session).model_copy(
        update={"recraft_remaining": max(recraft_budget - design_session.recraft_used, 0)}
    )
    motif_ids = _intent_motif_ids(design_session.current_intent)[:MAX_DESIGN_MOTIFS]
    if not motif_ids:
        return out
    rows = await session.execute(
        select(Motif, UserMotif.name)
        .outerjoin(
            UserMotif,
            (UserMotif.motif_id == Motif.id) & (UserMotif.user_id == design_session.user_id),
        )
        .where(Motif.id.in_(motif_ids))
    )
    by_id = {motif.id: (motif, name) for motif, name in rows.all()}
    return out.model_copy(
        update={
            "current_motifs": [
                CurrentMotifOut(
                    motif_id=motif_id,
                    name=by_id[motif_id][1],
                    preview_svg=_motif_preview_svg(by_id[motif_id][0]),
                )
                for motif_id in motif_ids
                if motif_id in by_id
            ]
        }
    )


@router.post("/design/palette/extract", response_model=PaletteExtractOut)
async def extract_design_palette(
    body: PaletteExtractRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> PaletteExtractOut:
    image = await _resolve_staged_reference_image(
        body.upload_id,
        session=session,
        user_id=user.id,
        request=request,
    )
    response = await request.app.state.worker.palette_extract(
        {
            "image": await _reference_image_payload(image, request),
            "color_count": body.color_count,
        }
    )
    try:
        return PaletteExtractOut.model_validate(response)
    except ValidationError as exc:
        raise UpstreamError("팔레트 추출 워커 응답 형식이 올바르지 않습니다") from exc


@router.post("/design/motifs/text-preview", response_model=MotifPreviewOut)
async def preview_text_motif(
    body: TextMotifPreviewRequest,
    request: Request,
    _user: CurrentUser,
) -> MotifPreviewOut:
    try:
        return MotifPreviewOut.model_validate(
            await request.app.state.worker.motif_text_preview(body.model_dump())
        )
    except ValidationError as exc:
        raise UpstreamError("텍스트 모티프 워커 응답 형식이 올바르지 않습니다") from exc


@router.post("/design/motifs/photo-preview", response_model=MotifPreviewOut)
async def preview_photo_motif(
    body: PhotoMotifPreviewRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> MotifPreviewOut:
    image = await _resolve_staged_reference_image(
        body.upload_id,
        session=session,
        user_id=user.id,
        request=request,
    )
    payload = body.model_dump(exclude={"upload_id"})
    payload["image"] = await _reference_image_payload(image, request)
    try:
        return MotifPreviewOut.model_validate(
            await request.app.state.worker.motif_photo_preview(payload)
        )
    except ValidationError as exc:
        raise UpstreamError("사진 모티프 워커 응답 형식이 올바르지 않습니다") from exc


@router.post("/design/ideas", response_model=DesignIdeasOut)
async def create_design_ideas(
    body: DesignIdeasRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> DesignIdeasOut:
    """현재 작성 문맥만 전송하는 무과금 helper. 세션 턴과 토큰 원장에는 기록하지 않는다."""
    request.app.state.design_ideas_rate_limiter.check(f"user:{user.id}")
    user_motifs = await _resolve_user_motifs(
        body.user_motif_ids,
        session=session,
        user_id=user.id,
    )
    payload = body.model_dump(exclude={"user_motif_ids"})
    payload["motif_ids"] = [motif.id for _, motif in user_motifs]
    payload["motifs"] = [{"motif_id": motif.id, "name": link.name} for link, motif in user_motifs]
    try:
        out = DesignIdeasOut.model_validate(await request.app.state.worker.ideas(payload))
    except ValidationError as exc:
        raise UpstreamError("아이디어 워커 응답 형식이 올바르지 않습니다") from exc
    if len(out.ideas) != body.count:
        raise UpstreamError("아이디어 워커가 요청한 후보 수를 반환하지 않았습니다")
    return out


async def _user_motif_link_state(
    session: SessionDep, *, user_id: uuid.UUID, motif_id: str
) -> tuple[UserMotif | None, int]:
    """user-motif 락을 잡고 기존 링크·보유 수를 읽는다 — 저장 경로(import·생성) 공통."""
    await advisory_xact_lock(session, f"user-motif:{user_id}")
    existing = await session.scalar(
        select(UserMotif).where(UserMotif.user_id == user_id, UserMotif.motif_id == motif_id)
    )
    count = int(
        await session.scalar(
            select(func.count()).select_from(UserMotif).where(UserMotif.user_id == user_id)
        )
        or 0
    )
    return existing, count


@router.post("/design/motifs", response_model=UserMotifOut, status_code=201)
async def import_user_motif(
    body: UserMotifImportRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> UserMotifOut:
    name = body.name.strip()
    if not name:
        raise DomainError("모티프 이름을 입력해 주세요", code="invalid_motif_name")
    try:
        worker_out = WorkerMotifImportOut.model_validate(
            await request.app.state.worker.motif_import({"svg": body.svg})
        )
    except ValidationError as exc:
        raise UpstreamError("모티프 워커 응답 형식이 올바르지 않습니다") from exc

    existing, count = await _user_motif_link_state(
        session, user_id=user.id, motif_id=worker_out.motif_id
    )
    if existing is not None:
        motif = await session.get(Motif, worker_out.motif_id)
        if motif is None or motif.source != "user_upload":
            raise UpstreamError("가져온 모티프를 확인하지 못했습니다")
        return _user_motif_out(existing, motif)
    if count >= MAX_USER_MOTIFS:
        raise ConflictError(
            "내 모티프는 최대 100개까지 저장할 수 있습니다",
            code="user_motif_limit",
        )
    await session.execute(
        pg_insert(Motif)
        .values(
            id=worker_out.motif_id,
            symbol=worker_out.symbol,
            color_slots=worker_out.color_slots,
            bbox=list(worker_out.bbox),
            anchor=list(worker_out.anchor),
            subject="user upload",
            scope="whole",
            view=None,
            expression=None,
            style=None,
            description=None,
            tags=[],
            source="user_upload",
            quality=None,
            variant_group=None,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    motif = await session.get(Motif, worker_out.motif_id)
    if (
        motif is None
        or motif.source != "user_upload"
        or motif.symbol != worker_out.symbol
        or list(motif.color_slots) != worker_out.color_slots
        or list(motif.bbox) != list(worker_out.bbox)
        or list(motif.anchor) != list(worker_out.anchor)
    ):
        raise UpstreamError("가져온 모티프를 확인하지 못했습니다")
    link = UserMotif(user_id=user.id, motif_id=motif.id, name=name)
    session.add(link)
    await session.commit()
    await session.refresh(link)
    return _user_motif_out(link, motif)


@router.get("/design/motifs", response_model=list[UserMotifOut])
async def list_user_motifs(
    session: SessionDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[UserMotifOut]:
    rows = (
        await session.execute(
            select(UserMotif, Motif)
            .join(Motif, Motif.id == UserMotif.motif_id)
            # 링크 존재 자체가 "내가 만든 것"의 진실 — import와 generate만 링크를 만든다.
            .where(UserMotif.user_id == user.id)
            .order_by(UserMotif.created_at.desc(), UserMotif.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return [_user_motif_out(link, motif) for link, motif in rows]


@router.delete("/design/motifs/{user_motif_id}", status_code=204)
async def delete_user_motif(
    user_motif_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> None:
    link = await session.get(UserMotif, user_motif_id)
    ensure_owner(link, user)
    assert link is not None
    await session.delete(link)
    await session.commit()


@router.post("/design/sessions", response_model=DesignSessionOut, status_code=201)
async def create_design_session(session: SessionDep, user: CurrentUser) -> DesignSessionOut:
    design_session = DesignSession(user_id=user.id)
    session.add(design_session)
    await session.commit()
    await session.refresh(design_session)
    return DesignSessionOut.model_validate(design_session)


@router.get("/design/sessions", response_model=list[DesignSessionOut])
async def list_design_sessions(session: SessionDep, user: CurrentUser) -> list[DesignSessionOut]:
    last_prompt = (
        select(DesignSessionTurn.payload["prompt"].astext)
        .where(
            DesignSessionTurn.session_id == DesignSession.id,
            DesignSessionTurn.payload["type"].astext == "generate_request",
            DesignSessionTurn.payload["prompt"].astext.is_not(None),
        )
        .order_by(DesignSessionTurn.seq.desc())
        .limit(1)
        .scalar_subquery()
    )
    rows = await session.execute(
        select(DesignSession, last_prompt)
        .where(DesignSession.user_id == user.id)
        .order_by(DesignSession.created_at.desc())
    )
    return [
        DesignSessionOut.model_validate(s).model_copy(update={"last_prompt": prompt})
        for s, prompt in rows.all()
    ]


@router.get("/design/sessions/{session_id}", response_model=DesignSessionOut)
async def get_design_session(
    session_id: uuid.UUID, session: SessionDep, user: CurrentUser, settings: SettingsDep
) -> DesignSessionOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    out = await _design_session_out(session, design_session, settings.design_recraft_budget)
    # 표시용 쿼터 — 설정 행이 없으면 null로 둔다(페이지를 깨지 않음). 소유자 검증
    # 이후에 계산해 authz 403/404 순서를 보존한다.
    limit = await load_finalize_limit(session)
    if limit is not None:
        quota = await get_finalize_quota(session, user.id, limit)
        out = out.model_copy(
            update={"finalize_quota": FinalizeQuotaOut.model_validate(quota, from_attributes=True)}
        )
    return out


@router.delete("/design/sessions/{session_id}", status_code=204)
async def delete_design_session(
    session_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    """세션과 턴 이력을 삭제한다. finalize 결과물은 독립 소유라 남긴다."""
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    await session.delete(design_session)
    await session.commit()


@router.get("/design/sessions/{session_id}/turns", response_model=list[DesignTurnOut])
async def list_design_turns(
    session_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> list[DesignTurnOut]:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    rows = list(
        await session.scalars(
            select(DesignSessionTurn)
            .where(DesignSessionTurn.session_id == session_id)
            .order_by(DesignSessionTurn.seq)
        )
    )
    return await _design_turn_outs(rows, session=session, request=request)


def _logged_design(log: SeamlessGenerationLog) -> dict[str, Any] | None:
    """워커 로그가 보관한 단일 디자인 — 생성 1회 = 디자인 1개."""
    return log.design if isinstance(log.design, dict) else None


async def _design_turn_outs(
    turns: list[DesignSessionTurn],
    *,
    session: SessionDep,
    request: Request,
) -> list[DesignTurnOut]:
    by_turn: dict[uuid.UUID, list[DesignTurnAttachmentOut]] = {turn.id: [] for turn in turns}
    run_ids: list[uuid.UUID] = []
    for turn in turns:
        raw_run_id = turn.payload.get("run_id")
        if (
            turn.role == "assistant"
            and turn.payload.get("type") == "generate"
            and turn.payload.get("status") == "succeeded"
            and isinstance(raw_run_id, str)
        ):
            try:
                run_ids.append(uuid.UUID(raw_run_id))
            except ValueError:
                continue
    logs_by_id: dict[uuid.UUID, SeamlessGenerationLog] = {}
    if run_ids:
        logs_by_id = {
            log.id: log
            for log in await session.scalars(
                select(SeamlessGenerationLog).where(SeamlessGenerationLog.id.in_(run_ids))
            )
        }
    if turns:
        attachment_rows = await session.execute(
            select(DesignTurnAttachment, Motif)
            .join(Motif, Motif.id == DesignTurnAttachment.motif_id)
            .where(DesignTurnAttachment.turn_id.in_([turn.id for turn in turns]))
            .order_by(DesignTurnAttachment.turn_id, DesignTurnAttachment.ordinal)
        )
        for attachment, motif in attachment_rows:
            try:
                preview_svg = _motif_preview_svg(motif)
            except DomainError:
                continue  # 손상된 모티프 SVG — 해당 첨부만 제외하고 이력은 유지
            by_turn.setdefault(attachment.turn_id, []).append(
                DesignTurnAttachmentOut(
                    filename=attachment.filename,
                    preview_svg=preview_svg,
                )
            )
    outputs: list[DesignTurnOut] = []
    for turn in turns:
        payload = dict(turn.payload)
        if turn.role == "assistant" and payload.get("type") == "generate":
            if payload.get("status") == "error":
                payload = {
                    "type": "generate_error",
                    "run_id": payload.get("run_id"),
                    "status": "error",
                    "error": payload.get("error"),
                }
            else:
                try:
                    run_id = uuid.UUID(str(payload.get("run_id")))
                except ValueError:
                    run_id = None
                log = logs_by_id.get(run_id) if run_id is not None else None
                design = _logged_design(log) if log is not None else None
                if log is not None and design is not None:
                    try:
                        design_json = DesignOut.model_validate(design).model_dump(mode="json")
                    except ValidationError:
                        design_json = None  # 레거시/손상 로그 — 해당 턴만 response 생략
                    if design_json is not None:
                        payload["response"] = {
                            "run_id": str(log.id),
                            "request_id": log.request_id or "",
                            "registry_version": log.registry_version or "",
                            "engine_version": log.engine_version or "",
                            "design": design_json,
                            "warnings": log.warnings,
                        }
        outputs.append(
            DesignTurnOut.model_validate(turn).model_copy(
                update={
                    "payload": payload,
                    "attachments": by_turn[turn.id],
                }
            )
        )
    return outputs


@router.post("/design/sessions/{session_id}/turns", response_model=DesignTurnOut, status_code=201)
async def append_design_turn(
    session_id: uuid.UUID,
    body: DesignTurnCreateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> DesignTurnOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    turn = await _append_turn(
        session,
        session_id,
        body.role,
        body.payload,
    )
    await session.commit()
    await session.refresh(turn)
    return DesignTurnOut.model_validate(turn)


@router.post(
    "/design/generate",
    response_model=DesignGenerateOut | DesignGenerateRejectedOut,
)
async def generate_design(
    body: DesignGenerateRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> DesignGenerateOut | DesignGenerateRejectedOut:
    design_session = await session.get(DesignSession, body.session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    # 커밋된 디자인이 있으면 입력창은 구성만 바꾼다 — 무늬는 모티프 경로로.
    if design_session.current_intent is not None and body.user_motif_ids:
        raise DomainError(
            "이미 만든 디자인은 문장으로만 고칠 수 있습니다. 무늬는 모티프에서 바꿔주세요",
            code="motif_input_conflict",
            status=422,
            stage="constraints",
        )
    user_motifs = await _resolve_user_motifs(
        body.user_motif_ids,
        session=session,
        user_id=user.id,
    )
    conversation_context = await _build_conversation_context(session, design_session)
    expected_context_version = design_session.context_version
    run_id = uuid.uuid4()
    payload = body.model_dump(
        exclude={"session_id", "user_motif_ids"},
        exclude_none=True,
    )
    payload["run_id"] = str(run_id)
    # 로그 표식 — admin이 생성 로그를 요청자·세션 턴과 상관하는 근거(과금 provenance 아님).
    payload["session_id"] = str(design_session.id)
    payload["user_id"] = str(user.id)
    if conversation_context is not None:
        payload["conversation_context"] = conversation_context
    if user_motifs:
        payload["motif_ids"] = [motif.id for _, motif in user_motifs]

    return await _shielded(
        _dispatch_generation(
            payload=payload,
            request=request,
            session=session,
            user_id=user.id,
            design_session_id=design_session.id,
            expected_context_version=expected_context_version,
            run_id=run_id,
            # 커밋된 디자인을 고치는 요청(patch)은 첫 생성보다 싸다.
            cost_key=(
                ledger.DESIGN_EDIT_COST_SETTING
                if conversation_context is not None
                else ledger.TOKEN_COST_SETTING
            ),
            user_turn=DesignUserGenerationPayload(
                run_id=run_id,
                mode="prompt",
                prompt=body.prompt,
                seed=body.seed,
                colorway=body.colorway,
                palette=body.palette,
                attachment_refs=_generation_attachment_refs(user_motifs),
            ),
            user_motifs=user_motifs,
        )
    )


async def _shielded[ResultT](coro: Coroutine[Any, Any, ResultT]) -> ResultT:
    """클라이언트가 끊겨도 시작한 생성은 끝까지 마무리한다 — 과금·턴·포인터를 정합하게 남긴다."""

    completion = asyncio.create_task(coro)
    try:
        return await asyncio.shield(completion)
    except asyncio.CancelledError:
        try:
            await completion
        except Exception:
            logger.warning("generation completion failed after client cancellation", exc_info=True)
        raise


@router.post(
    "/design/sessions/{session_id}/steps/activate",
    response_model=DesignSessionOut,
)
async def activate_design_step(
    session_id: uuid.UUID,
    body: DesignStepActivateRequest,
    session: SessionDep,
    user: CurrentUser,
    settings: SettingsDep,
) -> DesignSessionOut:
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user.id))
    design_session = await session.scalar(
        select(DesignSession).where(DesignSession.id == session_id).with_for_update()
    )
    ensure_owner(design_session, user)
    assert design_session is not None
    if design_session.active_generation_id is not None:
        raise ConflictError(
            "디자인 생성이 진행 중입니다",
            code="generation_in_progress",
        )

    # 과거 런 포함, 이 세션에서 성공한 런이면 편집 포인터를 그 스텝으로 옮길 수 있다 —
    # 이후 스텝은 그대로 남고, 다음 생성이 완료되면 포인터가 다시 최신으로 이동한다.
    run_turn = await session.scalar(
        select(DesignSessionTurn)
        .where(
            DesignSessionTurn.session_id == session_id,
            DesignSessionTurn.role == "assistant",
            DesignSessionTurn.payload["type"].astext == "generate",
            DesignSessionTurn.payload["status"].astext == "succeeded",
            DesignSessionTurn.payload["run_id"].astext == str(body.run_id),
        )
        .limit(1)
    )
    if run_turn is None:
        raise ConflictError(
            "이 대화의 생성 결과가 아닙니다",
            code="design_result_unavailable",
        )

    resolved = await _resolve_design_run(session, run_id=body.run_id)
    await _ensure_intent_motif_access(
        resolved.intent,
        session=session,
        user_id=user.id,
        design_session_id=design_session.id,
    )

    design_session.current_intent = resolved.intent
    design_session.current_plan = resolved.plan
    design_session.seed = resolved.seed
    design_session.colorway = resolved.colorway_id
    design_session.registry_version = resolved.log.registry_version
    design_session.context_version += 1
    await _append_turn(
        session,
        design_session.id,
        "user",
        DesignStepActivateTurnPayload(
            run_id=body.run_id,
            seed=resolved.seed,
            colorway_id=resolved.colorway_id,
        ),
    )
    await session.commit()
    await session.refresh(design_session)
    return await _design_session_out(session, design_session, settings.design_recraft_budget)


async def _resolve_design_run(
    session: SessionDep,
    *,
    run_id: uuid.UUID,
) -> _ResolvedDesignRun:
    """런 하나에 디자인 하나 — 로그에서 intent·plan·재현 정보를 복원한다."""
    log = await session.get(SeamlessGenerationLog, run_id)
    if log is None or log.status not in {"success", "partial"}:
        raise ConflictError(
            "생성 결과를 찾을 수 없습니다",
            code="design_result_unavailable",
        )
    design = _logged_design(log)
    if design is None:
        raise ConflictError(
            "생성 결과의 디자인 정보가 없습니다",
            code="design_result_invalid",
        )
    intent_log = log.intent if isinstance(log.intent, dict) else {}
    # 구성 patch로 만든 스텝에는 저작 plan이 없다 — 복원 정본은 intent다.
    raw_plan = intent_log.get("resolved_plan")
    design_intent = design.get("intent")
    if not isinstance(design_intent, dict):
        raise ConflictError(
            "생성 결과의 렌더 정보를 복원할 수 없습니다",
            code="design_intent_unavailable",
        )
    seed = design.get("seed")
    colorway_id = design.get("colorway_id")
    if not isinstance(seed, int) or not isinstance(colorway_id, str) or not colorway_id:
        raise ConflictError(
            "생성 결과의 재현 정보가 올바르지 않습니다",
            code="design_result_invalid",
        )

    return _ResolvedDesignRun(
        log=log,
        intent=_bounded_design_json(design_intent),
        plan=_bounded_design_json(raw_plan) if isinstance(raw_plan, dict) else None,
        seed=seed,
        colorway_id=colorway_id,
    )


def _generation_attachment_refs(
    user_motifs: list[tuple[UserMotif, Motif]],
) -> list[DesignTurnAttachmentRefPayload]:
    return [DesignTurnAttachmentRefPayload(filename=link.name) for link, _motif in user_motifs]


async def _build_conversation_context(
    session: SessionDep,
    design_session: DesignSession,
) -> dict[str, Any] | None:
    if design_session.current_intent is None:
        return None
    turns = list(
        await session.scalars(
            select(DesignSessionTurn)
            .where(DesignSessionTurn.session_id == design_session.id)
            .order_by(DesignSessionTurn.seq)
        )
    )
    user_by_run: dict[str, dict[str, Any]] = {}
    assistant_by_run: dict[str, dict[str, Any]] = {}
    activated_runs: set[str] = set()
    run_order: list[str] = []
    for turn in turns:
        payload = turn.payload
        run_id = payload.get("run_id")
        if not isinstance(run_id, str):
            continue
        payload_type = payload.get("type")
        if turn.role == "user" and payload_type == "generate_request":
            user_by_run[run_id] = payload
            run_order.append(run_id)
        elif (
            turn.role == "assistant"
            and payload_type == "generate"
            and payload.get("status") == "succeeded"
        ):
            assistant_by_run[run_id] = payload
        elif turn.role == "user" and payload_type == "activate":
            activated_runs.add(run_id)

    history: list[dict[str, Any]] = []
    for run_id in run_order:
        user_payload = user_by_run.get(run_id)
        assistant_payload = assistant_by_run.get(run_id)
        if user_payload is None or assistant_payload is None or run_id not in activated_runs:
            continue
        prompt = user_payload.get("prompt")
        summary = assistant_payload.get("summary")
        if not isinstance(prompt, str) or not prompt or not isinstance(summary, str) or not summary:
            continue
        # 워커 계약은 {filename}뿐 — 참고 사진 시절의 kind:"photo"·purpose가 남은
        # 과거 턴 payload를 그대로 보내면 StrictRequest가 422로 거부한다.
        attachment_refs = user_payload.get("attachment_refs")
        attachments = [
            {"filename": ref["filename"]}
            for ref in (attachment_refs if isinstance(attachment_refs, list) else [])
            if isinstance(ref, dict)
            and ref.get("kind", "svg") == "svg"
            and isinstance(ref.get("filename"), str)
            and 1 <= len(ref["filename"]) <= 255  # 워커 filename 계약: min 1, max 255
        ]
        history.append(
            {
                "user_prompt": prompt,
                "assistant_summary": summary,
                "attachments": attachments[:2],
            }
        )
    return {
        "current_intent": design_session.current_intent,
        "history": history[-6:],
    }


def _short_design_description(plan: dict[str, Any] | None) -> str:
    if not isinstance(plan, dict):
        return "디자인"
    colors = plan.get("colors")
    layers = plan.get("layers")
    color_count = len(colors) if isinstance(colors, list) else 0
    descriptions: list[str] = []
    if isinstance(layers, list):
        for layer in layers:
            if not isinstance(layer, dict):
                continue
            if layer.get("type") == "stripe":
                direction = layer.get("direction")
                descriptions.append(f"스트라이프({direction})")
            elif layer.get("type") == "motif":
                placement = layer.get("placement")
                placement_type = placement.get("type") if isinstance(placement, dict) else "motif"
                descriptions.append(f"모티프({placement_type})")
    structure = ", ".join(descriptions) if descriptions else "단색 구조"
    return f"{color_count}색 · {structure}"


async def _recover_stale_active_generation(
    session: SessionDep,
    design_session: DesignSession,
    user_id: uuid.UUID,
    now: datetime,
) -> None:
    run_id = design_session.active_generation_id
    started_at = design_session.active_generation_started_at
    if run_id is None or started_at is None or started_at >= now - STALE_GENERATION_JOB_AFTER:
        return
    await ledger.refund_failed_generation(
        session,
        user_id,
        None,
        f"design_generate_{run_id.hex}",
        commit=False,
    )
    has_terminal_turn = await session.scalar(
        select(func.count()).where(
            DesignSessionTurn.session_id == design_session.id,
            DesignSessionTurn.role == "assistant",
            DesignSessionTurn.payload["run_id"].astext == str(run_id),
        )
    )
    if not has_terminal_turn:
        await _append_turn(
            session,
            design_session.id,
            "assistant",
            DesignAssistantGenerationPayload(
                run_id=run_id,
                status="error",
                error=DesignAssistantErrorPayload(
                    stage="generation",
                    code="generation_stale",
                ),
            ),
        )
    design_session.active_generation_id = None
    design_session.active_generation_started_at = None
    design_session.context_version += 1


async def _start_generation(
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    design_session_id: uuid.UUID,
    expected_context_version: int,
    run_id: uuid.UUID,
    cost_key: str,
    user_turn: DesignUserGenerationPayload,
    user_motifs: list[tuple[UserMotif, Motif]],
) -> int:
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user_id))
    design_session = await session.scalar(
        select(DesignSession)
        .where(
            DesignSession.id == design_session_id,
            DesignSession.user_id == user_id,
        )
        .with_for_update()
    )
    if design_session is None:
        raise ConflictError("디자인 세션을 찾을 수 없습니다")
    now = datetime.now(UTC)
    if design_session.context_version != expected_context_version:
        await session.rollback()
        raise ConflictError(
            "디자인 대화 상태가 변경되었습니다",
            code="stale_design_context",
        )
    await _recover_stale_active_generation(session, design_session, user_id, now)
    if design_session.active_generation_id is not None:
        await session.rollback()
        raise ConflictError(
            "디자인 생성이 진행 중입니다",
            code="generation_in_progress",
        )

    work_id = f"design_generate_{run_id.hex}"
    charge = await ledger.use_tokens(
        session,
        user_id,
        work_id,
        cost_key=cost_key,
        commit=False,
    )
    if not charge.success:
        await session.commit()
        detail = (
            "환불 심사 중에는 생성할 수 없습니다"
            if charge.error == "refund_pending"
            else "디자인 토큰이 부족합니다"
        )
        raise DomainError(detail, code=charge.error or "insufficient_tokens")

    user_turn_row = await _append_turn(
        session,
        design_session.id,
        "user",
        user_turn,
    )
    for index, (link, motif) in enumerate(user_motifs):
        session.add(
            DesignTurnAttachment(
                turn_id=user_turn_row.id,
                motif_id=motif.id,
                filename=link.name,
                ordinal=index,
            )
        )
    design_session.active_generation_id = run_id
    design_session.active_generation_started_at = now
    design_session.context_version += 1
    await session.commit()
    return charge.cost


async def _finish_generation_success(
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    design_session_id: uuid.UUID,
    run_id: uuid.UUID,
    out: WorkerDesignGenerateOut,
    summary: str | None = None,
) -> DesignGenerateOut:
    if out.generation_log_id != run_id:
        raise UpstreamError("이미지 워커 실행 식별자가 올바르지 않습니다")
    public_out = DesignGenerateOut(
        run_id=run_id,
        request_id=out.request_id,
        registry_version=out.registry_version,
        engine_version=out.engine_version,
        design=DesignOut.model_validate(out.design.model_dump()),
        warnings=out.warnings,
        note=out.note,
    )
    # 구성 수정은 워커가 해석 한 줄(note)을 준다 — 이력·다음 문장의 문맥이 된다.
    summary = summary or out.note or _short_design_description(out.plan)
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user_id))
    design_session = await session.scalar(
        select(DesignSession)
        .where(
            DesignSession.id == design_session_id,
            DesignSession.user_id == user_id,
        )
        .with_for_update()
    )
    if design_session is None:
        raise ConflictError("디자인 세션을 찾을 수 없습니다")
    if design_session.active_generation_id != run_id:
        raise ConflictError(
            "만료된 생성 결과는 현재 세션을 변경할 수 없습니다",
            code="stale_generation_result",
        )
    design_session.registry_version = out.registry_version
    design_session.active_generation_id = None
    design_session.active_generation_started_at = None
    design_session.context_version += 1
    await _append_turn(
        session,
        design_session.id,
        "assistant",
        DesignAssistantGenerationPayload(
            run_id=run_id,
            status="succeeded",
            summary=summary,
        ),
    )
    # 편집 포인터는 항상 최신 스텝으로 이동 — 과거 스텝으로는 steps/activate로 되돌린다.
    # 커밋 실패는 생성 성공을 막지 않는다: 포인터가 이전 기준에 남을 뿐이다.
    try:
        resolved = await _resolve_design_run(session, run_id=run_id)
        await _ensure_intent_motif_access(
            resolved.intent,
            session=session,
            user_id=user_id,
            design_session_id=design_session.id,
        )
    except DomainError:
        logger.warning("step auto-activation skipped", exc_info=True)
    else:
        design_session.current_intent = resolved.intent
        design_session.current_plan = resolved.plan
        design_session.seed = resolved.seed
        design_session.colorway = resolved.colorway_id
        await _append_turn(
            session,
            design_session.id,
            "user",
            DesignStepActivateTurnPayload(
                run_id=run_id,
                seed=resolved.seed,
                colorway_id=resolved.colorway_id,
            ),
        )
    await session.commit()
    return public_out


async def _finish_generation_failure(
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    design_session_id: uuid.UUID,
    run_id: uuid.UUID,
    charge_cost: int,
    stage: str,
    code: str,
) -> None:
    await session.rollback()
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user_id))
    design_session = await session.scalar(
        select(DesignSession)
        .where(
            DesignSession.id == design_session_id,
            DesignSession.user_id == user_id,
        )
        .with_for_update()
    )
    await ledger.refund_failed_generation(
        session,
        user_id,
        charge_cost,
        f"design_generate_{run_id.hex}",
        commit=False,
    )
    if design_session is not None:
        has_terminal_turn = await session.scalar(
            select(func.count()).where(
                DesignSessionTurn.session_id == design_session.id,
                DesignSessionTurn.role == "assistant",
                DesignSessionTurn.payload["run_id"].astext == str(run_id),
            )
        )
        if not has_terminal_turn:
            await _append_turn(
                session,
                design_session.id,
                "assistant",
                DesignAssistantGenerationPayload(
                    run_id=run_id,
                    status="error",
                    error=DesignAssistantErrorPayload(stage=stage, code=code),
                ),
            )
        if design_session.active_generation_id == run_id:
            design_session.active_generation_id = None
            design_session.active_generation_started_at = None
            design_session.context_version += 1
    await session.commit()


async def _undo_generation(
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    design_session_id: uuid.UUID,
    run_id: uuid.UUID,
    charge_cost: int,
) -> None:
    """시작을 되돌린다 — 환불 + 요청 턴 삭제 + context_version 원복.

    범위 밖 거절은 결과가 아니라 무효한 시도다: 잔액·이력·문맥이 요청 전과 같아야 하고,
    그래야 프론트가 입력창 문장을 그대로 유지한 채 다시 보낼 수 있다. 생성 진행 중에는
    같은 세션의 다른 변경이 막히므로(active_generation_id) 원복이 남의 변경을 지우지 않는다.
    """

    await session.rollback()
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user_id))
    design_session = await session.scalar(
        select(DesignSession)
        .where(
            DesignSession.id == design_session_id,
            DesignSession.user_id == user_id,
        )
        .with_for_update()
    )
    await ledger.refund_failed_generation(
        session,
        user_id,
        charge_cost,
        f"design_generate_{run_id.hex}",
        commit=False,
    )
    await session.execute(
        delete(DesignSessionTurn).where(
            DesignSessionTurn.session_id == design_session_id,
            DesignSessionTurn.payload["run_id"].astext == str(run_id),
        )
    )
    if design_session is not None and design_session.active_generation_id == run_id:
        design_session.active_generation_id = None
        design_session.active_generation_started_at = None
        # _start_generation이 올린 1만 되돌린다 — stale 회수가 함께 올린 몫은 남긴다.
        design_session.context_version = max(0, design_session.context_version - 1)
    await session.commit()


async def _dispatch_generation(
    *,
    payload: dict[str, Any],
    request: Request,
    session: SessionDep,
    user_id: uuid.UUID,
    design_session_id: uuid.UUID,
    expected_context_version: int,
    run_id: uuid.UUID,
    cost_key: str,
    user_turn: DesignUserGenerationPayload,
    user_motifs: list[tuple[UserMotif, Motif]],
) -> DesignGenerateOut | DesignGenerateRejectedOut:
    try:
        charge_cost = await _start_generation(
            session=session,
            user_id=user_id,
            design_session_id=design_session_id,
            expected_context_version=expected_context_version,
            run_id=run_id,
            cost_key=cost_key,
            user_turn=user_turn,
            user_motifs=user_motifs,
        )
    except DomainError:
        await session.rollback()
        raise
    except Exception as exc:
        await session.rollback()
        logger.warning("generation start transaction failed", exc_info=True)
        raise UpstreamError("디자인 생성을 시작하지 못했습니다") from exc

    try:
        response = await request.app.state.worker.generate(payload)
        if isinstance(response, dict) and response.get("status") == "scope_rejected":
            await _undo_generation(
                session=session,
                user_id=user_id,
                design_session_id=design_session_id,
                run_id=run_id,
                charge_cost=charge_cost,
            )
            return DesignGenerateRejectedOut(rejected="motif")
        try:
            out = WorkerDesignGenerateOut.model_validate(response)
        except ValidationError as exc:
            raise UpstreamError("이미지 워커 응답 형식이 올바르지 않습니다") from exc
        return await _finish_generation_success(
            session=session,
            user_id=user_id,
            design_session_id=design_session_id,
            run_id=run_id,
            out=out,
        )
    except (UpstreamError, WorkerRequestError, ConflictError) as exc:
        await _finish_generation_failure(
            session=session,
            user_id=user_id,
            design_session_id=design_session_id,
            run_id=run_id,
            charge_cost=charge_cost,
            stage=exc.stage or "generation",
            code=exc.code,
        )
        raise
    except Exception as exc:
        await _finish_generation_failure(
            session=session,
            user_id=user_id,
            design_session_id=design_session_id,
            run_id=run_id,
            charge_cost=charge_cost,
            stage="generation",
            code="generation_failed",
        )
        logger.warning("generation completion failed after charge", exc_info=True)
        raise UpstreamError("디자인 생성을 완료하지 못했습니다") from exc


async def _resolve_staged_reference_image(
    upload_id: uuid.UUID,
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    request: Request,
) -> Image:
    image = await session.get(Image, upload_id)
    now = datetime.now(UTC)
    if (
        image is None
        or image.entity_type != "design_reference_upload"
        or image.uploaded_by != user_id
        or image.upload_completed_at is None
        or image.content_type is None
        or image.size_bytes is None
        or not 0 < image.size_bytes <= MAX_ORDER_IMAGE_BYTES
        or image.deleted_at is not None
        or image.deletion_claimed_at is not None
        or (image.expires_at is not None and image.expires_at <= now)
    ):
        raise DomainError(
            "유효하지 않은 업로드 이미지입니다",
            code="invalid_design_reference",
            status=409,
        )
    if request.app.state.gcs.upload_required:
        metadata = await request.app.state.gcs.object_metadata(image.object_key)
        if (
            metadata is None
            or metadata.content_type != image.content_type
            or metadata.size_bytes != image.size_bytes
        ):
            raise DomainError(
                "업로드 이미지를 확인하지 못했습니다",
                code="invalid_design_reference",
                status=409,
            )
    return image


async def _resolve_user_motifs(
    user_motif_ids: list[uuid.UUID],
    *,
    session: SessionDep,
    user_id: uuid.UUID,
) -> list[tuple[UserMotif, Motif]]:
    motifs: list[tuple[UserMotif, Motif]] = []
    for user_motif_id in user_motif_ids:
        row = (
            await session.execute(
                select(UserMotif, Motif)
                .join(Motif, Motif.id == UserMotif.motif_id)
                .where(
                    UserMotif.id == user_motif_id,
                    UserMotif.user_id == user_id,
                    Motif.source == "user_upload",
                )
            )
        ).first()
        if row is None:
            raise DomainError(
                "내 모티프를 찾을 수 없습니다",
                code="invalid_user_motif",
                status=409,
            )
        motifs.append((row[0], row[1]))
    return motifs


def _intent_motif_ids(intent: object) -> list[str]:
    """Return the motif IDs consumed by the worker registry, in layer order."""
    motif_ids: dict[str, None] = {}
    if not isinstance(intent, dict):
        return []
    layers = intent.get("layers")
    if not isinstance(layers, list):
        return []
    for layer in layers:
        if not isinstance(layer, dict) or layer.get("type") != "motif":
            continue
        params = layer.get("params")
        motif_id = params.get("motif_id") if isinstance(params, dict) else None
        if isinstance(motif_id, str) and motif_id:
            motif_ids[motif_id] = None
    return list(motif_ids)


async def _ensure_intent_motif_access(
    intent: object,
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    design_session_id: uuid.UUID | None,
) -> None:
    await _ensure_motif_access(
        _intent_motif_ids(intent),
        session=session,
        user_id=user_id,
        design_session_id=design_session_id,
    )


async def _ensure_motif_access(
    motif_ids: list[str],
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    design_session_id: uuid.UUID | None,
) -> None:
    """Authorize private motif IDs exactly where the worker will resolve them.

    A current library link authorizes new use. A same-owner session attachment also
    authorizes replay after the user removes that motif from their library.
    """
    if not motif_ids:
        return
    private_ids = set(
        await session.scalars(
            select(Motif.id).where(
                Motif.id.in_(motif_ids),
                Motif.source == "user_upload",
            )
        )
    )
    if not private_ids:
        return
    allowed_ids = set(
        await session.scalars(
            select(UserMotif.motif_id).where(
                UserMotif.user_id == user_id,
                UserMotif.motif_id.in_(private_ids),
            )
        )
    )
    if design_session_id is not None:
        historical_ids = await session.scalars(
            select(DesignTurnAttachment.motif_id)
            .join(
                DesignSessionTurn,
                DesignSessionTurn.id == DesignTurnAttachment.turn_id,
            )
            .join(
                DesignSession,
                DesignSession.id == DesignSessionTurn.session_id,
            )
            .where(
                DesignSession.id == design_session_id,
                DesignSession.user_id == user_id,
                DesignTurnAttachment.motif_id.in_(private_ids),
            )
        )
        allowed_ids.update(motif_id for motif_id in historical_ids if motif_id is not None)
    if private_ids - allowed_ids:
        raise DomainError(
            "내 모티프를 찾을 수 없습니다",
            code="invalid_user_motif",
            status=409,
        )


async def _reference_image_payload(
    image: Image,
    request: Request,
) -> dict[str, str | int]:
    assert image.content_type is not None
    assert image.size_bytes is not None
    return {
        "url": await request.app.state.gcs.signed_read_url(image.object_key),
        "content_type": image.content_type,
        "size_bytes": image.size_bytes,
    }


@router.post("/design/export")
async def export_design(
    body: DesignExportRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> Response:
    """디자인 SVG를 PNG/TIFF로 변환해 바이너리로 반환 (워커 /export 프록시, 과금 없음)."""
    if body.session_id is not None:
        ensure_owner(await session.get(DesignSession, body.session_id), user)
    data, media = await request.app.state.worker.export(
        body.model_dump(exclude={"session_id"}, exclude_none=True)
    )
    return Response(content=data, media_type=media)


@router.post(
    "/design/sessions/{session_id}/finalize",
    response_model=GenerationJobOut,
    status_code=201,
)
async def create_finalize_job(
    session_id: uuid.UUID,
    body: FinalizeRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> GenerationJobOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    intent = body.intent or design_session.current_intent
    if intent is None:
        raise ConflictError("finalize할 intent가 없습니다")
    await _ensure_intent_motif_access(
        intent,
        session=session,
        user_id=user.id,
        design_session_id=design_session.id,
    )
    if body.weave is not None and body.weave not in KNOWN_WEAVES:
        raise DomainError(f"알 수 없는 weave입니다: {body.weave}", code="unknown_weave")

    run_id = body.run_id
    if run_id is None and intent == design_session.current_intent:
        latest_step = await session.scalar(
            select(DesignSessionTurn)
            .where(
                DesignSessionTurn.session_id == design_session.id,
                DesignSessionTurn.role == "user",
                DesignSessionTurn.payload["type"].astext == "activate",
            )
            .order_by(DesignSessionTurn.seq.desc())
            .limit(1)
        )
        if latest_step is not None:
            try:
                step = DesignStepActivateTurnPayload.model_validate(latest_step.payload)
            except ValidationError:
                pass
            else:
                run_id = step.run_id

    # 세션 포인터와 다른 intent는 스텝 출처(run_id) 없이 finalize할 수 없다 —
    # 임의 intent가 GenerationJob.params로 흘러가는 걸 막는다.
    if run_id is None and body.intent is not None and intent != design_session.current_intent:
        raise ConflictError(
            "finalize 출처를 확인할 수 없습니다",
            code="finalize_provenance_invalid",
        )

    if run_id is not None:
        activated_in_session = await session.scalar(
            select(DesignSessionTurn.id)
            .where(
                DesignSessionTurn.session_id == design_session.id,
                DesignSessionTurn.role == "user",
                DesignSessionTurn.payload["type"].astext == "activate",
                DesignSessionTurn.payload["run_id"].astext == str(run_id),
            )
            .limit(1)
        )
        if activated_in_session is None:
            raise ConflictError(
                "finalize 출처를 확인할 수 없습니다",
                code="finalize_provenance_invalid",
            )
        resolved = await _resolve_design_run(session, run_id=run_id)
        if resolved.intent != intent:
            raise ConflictError(
                "활성 스텝과 finalize intent가 일치하지 않습니다",
                code="finalize_intent_mismatch",
            )

    # 계정 24시간 쿼터 — advisory lock으로 동시 요청 직렬화, 같은 트랜잭션에서
    # job INSERT까지 커밋해야 다음 요청이 이 슬롯을 센다 (quota.py)
    await acquire_finalize_quota(session, user.id)
    job = GenerationJob(
        user_id=user.id,
        session_id=session_id,
        kind="finalize",
        params={
            "intent": intent,
            "colorway_id": body.colorway_id or design_session.colorway,
            "production_method": body.production_method,
            "dpi": body.dpi,
            # yarn_dyed 텍스처 노브 — None은 제외해 워커 기본값을 살린다.
            **{
                k: v
                for k, v in (
                    ("run_id", str(run_id) if run_id is not None else None),
                    ("weave", body.weave),
                    ("material_map", body.material_map),
                    ("texture_strength", body.texture_strength),
                    ("relief_strength", body.relief_strength),
                )
                if v is not None
            },
        },
        request_id=request_id_var.get(),
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    if request.app.state.settings.worker_finalize_inline:
        await request.app.state.worker.finalize_job(str(job.id))
        await session.refresh(job)
    else:
        try:
            await request.app.state.tasks.enqueue_finalize(job.id)
        except Exception as exc:
            dispatch_failed = await _fail_finalize_dispatch(session, job.id)
            if not dispatch_failed:
                # create 응답만 유실된 사이 task가 queued를 이미 claim했다. 이 경우
                # 전달은 성공한 것이므로 502로 거짓 보고하지 않는다.
                await session.refresh(job)
                return _generation_job_out(job, request.app.state.settings)
            if isinstance(exc, DomainError):
                raise
            raise UpstreamError("finalize 작업을 전달하지 못했습니다") from exc
    return _generation_job_out(job, request.app.state.settings)


async def _fail_finalize_dispatch(session: SessionDep, job_id: uuid.UUID) -> bool:
    """큐 전달 전 실패한 queued job만 실패 처리한다.

    failed job은 24시간 쿼터 카운트에서 빠지므로 슬롯은 자동 해제된다 — 환불 없음.
    조건부 UPDATE는 워커가 이미 claim한 job(ambiguous enqueue)을 판별하는 용도로 유지.
    """

    await session.rollback()
    failed = await session.execute(
        update(GenerationJob)
        .where(GenerationJob.id == job_id, GenerationJob.status == "queued")
        .values(
            status="failed",
            error_message=FINALIZE_DISPATCH_FAILED_MESSAGE,
            finished_at=datetime.now(UTC),
        )
    )
    dispatch_failed = cast("CursorResult[Any]", failed).rowcount > 0
    await session.commit()
    return dispatch_failed


@router.get("/design/jobs", response_model=list[GenerationJobOut])
async def list_generation_jobs(
    session: SessionDep,
    user: CurrentUser,
    settings: SettingsDep,
    kind: Literal["finalize", "export"] = "finalize",
    status: Literal["queued", "processing", "succeeded", "failed", "canceled"] | None = None,
    session_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[GenerationJobOut]:
    query = select(GenerationJob).where(
        GenerationJob.user_id == user.id,
        GenerationJob.kind == kind,
    )
    if status is not None:
        query = query.where(GenerationJob.status == status)
    if session_id is not None:
        query = query.where(GenerationJob.session_id == session_id)
    rows = await session.scalars(
        query.order_by(GenerationJob.created_at.desc()).limit(limit).offset(offset)
    )
    return [_generation_job_out(job, settings) for job in rows]


@router.get("/design/jobs/{job_id}", response_model=GenerationJobOut)
async def get_generation_job(
    job_id: uuid.UUID, session: SessionDep, user: CurrentUser, settings: SettingsDep
) -> GenerationJobOut:
    job = await session.get(GenerationJob, job_id)
    ensure_owner(job, user)
    assert job is not None
    # TTL(75분)을 넘긴 채 종결되지 못한 job은 폴링 시점에 lazy 회수 — Cloud
    # Scheduler가 없는 로컬에서도 동작하고, 배치 주기를 기다리지 않는다.
    # 인메모리 사전 판정으로 통과 못 하면 잠금 시도 없이 바로 반환한다.
    now = datetime.now(UTC)
    may_be_stale = (
        job.kind == "finalize"
        and job.status in ("queued", "processing", "failed")
        and job.created_at < now - STALE_GENERATION_JOB_AFTER
    )
    if may_be_stale:
        stale = (
            await session.scalars(
                select(GenerationJob)
                .where(GenerationJob.id == job_id, stale_finalize_clause(now))
                .with_for_update(skip_locked=True)
            )
        ).first()
        if stale is not None:
            resolve_stale_finalize_jobs([stale])
            await session.commit()
            await session.refresh(job)
    return _generation_job_out(job, settings)


@router.post("/design/jobs/{job_id}/cancel", response_model=GenerationJobOut)
async def cancel_generation_job(
    job_id: uuid.UUID, session: SessionDep, user: CurrentUser, settings: SettingsDep
) -> GenerationJobOut:
    """진행 중인 finalize job을 취소한다 (멱등).

    canceled job은 24시간 쿼터 카운트에서 빠지므로 슬롯은 자동 해제된다.
    조건부 UPDATE가 전이의 원자성을 보장한다 — 워커가 먼저 종결하면
    rowcount=0으로 지고, 늦게 도착한 워커 렌더 결과는 _finish_job의
    processing 가드에 걸려 무효화된다.
    """
    job = await session.get(GenerationJob, job_id)
    ensure_owner(job, user)
    assert job is not None
    if job.kind != "finalize":
        raise ConflictError("취소할 수 있는 작업이 아닙니다")
    canceled = await session.execute(
        update(GenerationJob)
        .where(GenerationJob.id == job_id, GenerationJob.status.in_(CANCELABLE_STATUSES))
        .values(
            status="canceled",
            result=None,
            error_message=FINALIZE_CANCELED_MESSAGE,
            finished_at=datetime.now(UTC),
        )
    )
    if cast("CursorResult[Any]", canceled).rowcount > 0:
        await session.commit()
    await session.refresh(job)
    if job.status != "canceled":
        raise ConflictError("이미 종료된 작업은 취소할 수 없습니다")
    return _generation_job_out(job, settings)


@router.delete("/design/jobs/{job_id}", status_code=204)
async def delete_generation_job(
    job_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    settings: SettingsDep,
) -> None:
    """종결된 잡을 삭제한다 — 진행 중이면 먼저 취소를 거쳐야 한다.

    주문은 산출물을 복사본(Image)으로 참조하므로 삭제와 무관하다. 삭제된 행은
    24시간 쿼터 카운트에서 빠져 슬롯이 풀린다 — 세션당 예산 시절의 "삭제해도
    미환불" 정책을 의도적으로 뒤집은 것(결과물을 버려야 슬롯이 나와 남용 유인 약함).
    """
    job = await session.get(GenerationJob, job_id)
    ensure_owner(job, user)
    assert job is not None
    if job.status not in ("succeeded", "failed", "canceled"):
        raise ConflictError("진행 중인 작업은 취소한 뒤에 삭제할 수 있습니다")
    object_key = _job_object_key(job)
    await session.delete(job)
    await session.commit()
    # 산출물 정리는 커밋 후 best-effort — 실패해도 사용자 상태는 이미 일관적이고,
    # 고아 객체는 로그로만 추적한다(멱등 delete_object라 재시도 부담 없음).
    if (
        isinstance(object_key, str)
        and object_key.startswith("fabric/")
        and ".." not in object_key.split("/")
    ):
        source_bucket = assets_bucket_name(settings)
        if source_bucket is None and request.app.state.gcs.upload_required:
            logger.error(
                "assets 버킷 미설정 — 삭제한 finalize 산출물을 정리하지 못했습니다: %s",
                object_key,
            )
        else:
            deleted = await request.app.state.gcs.delete_object(
                object_key, bucket_name=source_bucket
            )
            if not deleted:
                logger.error("삭제한 finalize 잡의 산출물 정리 실패: %s", object_key)


@router.post(
    "/design/jobs/{job_id}/order-reference",
    response_model=DesignOrderReferenceOut,
)
async def create_design_order_reference(
    job_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    settings: SettingsDep,
    kind: Literal["custom_order", "quote_request"] = "custom_order",
) -> DesignOrderReferenceOut:
    """소유한 finalize 결과를 주문 첨부용 비공개 객체로 가져온다."""

    job = await session.get(GenerationJob, job_id)
    ensure_owner(job, user)
    assert job is not None
    source_key = _job_object_key(job)
    if (
        job.kind != "finalize"
        or job.status != "succeeded"
        or not isinstance(source_key, str)
        or not source_key.startswith("fabric/")
        or ".." in source_key.split("/")
    ):
        raise ConflictError("주문에 사용할 수 있는 완성 디자인이 아닙니다")
    source_bucket = assets_bucket_name(settings)
    if request.app.state.gcs.upload_required and source_bucket is None:
        raise DomainError(
            "공개 생성물 버킷이 설정되지 않았습니다",
            code="asset_bucket_not_configured",
            status=503,
        )

    destination_key = f"uploads/{kind}/design-{job.id}-{uuid.uuid4().hex}.png"
    copied = await request.app.state.gcs.copy_from_bucket(
        source_bucket or "dry-run-assets",
        source_key,
        destination_key,
    )
    if not copied:
        raise UpstreamError("완성 디자인을 주문 첨부로 준비하지 못했습니다")
    try:
        if kind == "quote_request":
            staged_image = Image(
                object_key=destination_key,
                entity_type="quote_request_upload",
                entity_id=destination_key,
                uploaded_by=user.id,
                content_type="image/png",
                upload_completed_at=datetime.now(UTC),
                expires_at=datetime.now(UTC) + timedelta(hours=24),
            )
        else:
            metadata = await request.app.state.gcs.object_metadata(destination_key)
            if request.app.state.gcs.upload_required:
                if metadata is None:
                    raise UpstreamError("복사된 주문 참고 이미지를 확인하지 못했습니다")
                if not 0 < metadata.size_bytes <= MAX_ORDER_IMAGE_BYTES:
                    raise DomainError("이미지는 10MB 이하여야 합니다", code="image_too_large")
                if metadata.content_type != "image/png":
                    raise DomainError("이미지 형식이 일치하지 않습니다", code="invalid_image_type")
            staged_image = Image(
                object_key=destination_key,
                entity_type=order_upload_entity_type(kind),
                entity_id=destination_key,
                uploaded_by=user.id,
                content_type="image/png",
                size_bytes=metadata.size_bytes if metadata is not None else 1,
                upload_completed_at=datetime.now(UTC),
                expires_at=datetime.now(UTC) + timedelta(hours=24),
            )
        session.add(staged_image)
        await session.flush()
        await session.commit()
    except Exception:
        await session.rollback()
        try:
            deleted = await request.app.state.gcs.delete_object(destination_key)
        except Exception:
            logger.exception("복사 후 실패한 주문 참고 이미지 정리 중 예외: %s", destination_key)
        else:
            if not deleted:
                logger.error("복사 후 실패한 주문 참고 이미지 정리 실패: %s", destination_key)
        raise
    return DesignOrderReferenceOut(
        object_key=destination_key,
        upload_id=staged_image.id if kind == "custom_order" else None,
    )


def _job_object_key(job: GenerationJob) -> str | None:
    return job.result.get("object_key") if isinstance(job.result, dict) else None


def _generation_job_out(job: GenerationJob, settings) -> GenerationJobOut:  # noqa: ANN001
    object_key = _job_object_key(job)
    result_url = public_asset_url(settings, object_key) if isinstance(object_key, str) else None
    return GenerationJobOut(
        id=job.id,
        session_id=job.session_id,
        kind=job.kind,
        status=job.status,
        params=job.params,
        result=job.result,
        result_url=result_url,
        error_message=job.error_message,
        request_id=job.request_id,
        attempts=job.attempts,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


# ---- 모티프 프록시 — worker는 OIDC 프라이빗이라 api가 인증·예산을 얹어 중계 ----
#
# 모티프는 목록이 아니라 문장으로 찾고, 없으면 문장으로 만든다. 찾기·교체는 무료고
# 만들기만 세션 Recraft 예산을 쓴다. 문장 → MotifSpec 변환은 worker가 한다.


class MotifSearchRequest(StrictModel):
    query: str = Field(min_length=1, max_length=MAX_MOTIF_QUERY_LENGTH)


class MotifResultOut(BaseModel):
    """모달 카드 하나 — 프론트가 썸네일을 바로 그린다."""

    motif_id: str
    name: str | None
    preview_svg: str
    # 지금 디자인이 쓰고 있는 모티프인지 (슬롯 표시용)
    current: bool = False


class MotifSearchOut(BaseModel):
    results: list[MotifResultOut]


class MotifGenerateRequest(StrictModel):
    prompt: str = Field(min_length=1, max_length=MAX_MOTIF_QUERY_LENGTH)


class MotifGenerateOut(BaseModel):
    request_id: str
    # 래더 히트로 카탈로그를 재사용했으면 true — 예산은 환급된다.
    reused: bool
    motif: MotifResultOut
    # 내 모티프에 남겼는지 — 한도(100개)를 넘으면 생성만 되고 저장은 건너뛴다.
    saved: bool


class MotifActivateRequest(StrictModel):
    slot: Literal[1, 2]
    motif_id: str = Field(min_length=1, max_length=100)


class WorkerMotifCandidateOut(BaseModel):
    motif_id: str


class WorkerMotifCandidatesOut(BaseModel):
    candidates: list[WorkerMotifCandidateOut]


class WorkerMotifGenerateOut(BaseModel):
    request_id: str
    motif_id: str
    reused: bool


def _plan_style_hint(plan: dict[str, Any] | None) -> str | None:
    """현재 디자인의 스타일 단서 — plan 모티프의 style 문구를 그대로 넘긴다."""
    motifs = plan.get("motifs") if isinstance(plan, dict) else None
    if not isinstance(motifs, list):
        return None
    styles = [
        motif["style"].strip()
        for motif in motifs
        if isinstance(motif, dict)
        and isinstance(motif.get("style"), str)
        and motif["style"].strip()
    ]
    return ", ".join(dict.fromkeys(styles))[:200] or None


async def _motif_results(
    session: SessionDep,
    motif_ids: list[str],
    *,
    user_id: uuid.UUID,
    current_ids: Collection[str] = (),
    allow_ids: Collection[str] = (),
) -> list[MotifResultOut]:
    """카탈로그 행을 붙여 카드로 — 이름은 내 라이브러리 이름, 없으면 모티프 subject.

    워커 응답을 그대로 노출하지 않는다 — 공개 카탈로그, 내 라이브러리 링크,
    명시적 allow_ids(방금 생성한 모티프)만 통과.
    """
    if not motif_ids:
        return []
    rows = await session.execute(
        select(Motif, UserMotif.name)
        .outerjoin(
            UserMotif,
            (UserMotif.motif_id == Motif.id) & (UserMotif.user_id == user_id),
        )
        .where(
            Motif.id.in_(motif_ids),
            or_(
                Motif.source != "user_upload",
                UserMotif.motif_id.is_not(None),
                Motif.id.in_(allow_ids),
            ),
        )
    )
    by_id = {motif.id: (motif, name) for motif, name in rows.all()}
    return [
        MotifResultOut(
            motif_id=motif_id,
            name=by_id[motif_id][1] or by_id[motif_id][0].subject,
            preview_svg=_motif_preview_svg(by_id[motif_id][0]),
            current=motif_id in current_ids,
        )
        for motif_id in motif_ids
        if motif_id in by_id
    ]


@router.post("/design/sessions/{session_id}/motifs/search", response_model=MotifSearchOut)
async def search_motifs(
    session_id: uuid.UUID,
    body: MotifSearchRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> MotifSearchOut:
    """문장으로 카탈로그를 찾는다 — 워커가 Recraft를 호출하지 않으므로 무과금."""
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    payload: dict[str, Any] = {"query": body.query, "top_k": MOTIF_SEARCH_LIMIT}
    if (style_hint := _plan_style_hint(design_session.current_plan)) is not None:
        payload["style_hint"] = style_hint
    try:
        out = WorkerMotifCandidatesOut.model_validate(
            await request.app.state.worker.motif_candidates(payload)
        )
    except ValidationError as exc:
        raise UpstreamError("모티프 검색 워커 응답 형식이 올바르지 않습니다") from exc
    return MotifSearchOut(
        results=await _motif_results(
            session,
            [candidate.motif_id for candidate in out.candidates[:MOTIF_SEARCH_LIMIT]],
            user_id=user.id,
            current_ids=_intent_motif_ids(design_session.current_intent),
        )
    )


@router.post("/design/sessions/{session_id}/motifs/generate", response_model=MotifGenerateOut)
async def generate_motif(
    session_id: uuid.UUID,
    body: MotifGenerateRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> MotifGenerateOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    style_hint = _plan_style_hint(design_session.current_plan)
    # 예산 선차감(조건부 UPDATE — finalize와 동일 패턴) 후 커밋 — Recraft가 수십 초라
    # 행 잠금을 들고 있지 않는다. 워커 실패·래더 재사용(reused)이면 보상 환급.
    budget = request.app.state.settings.design_recraft_budget
    claimed = await session.execute(
        update(DesignSession)
        .where(DesignSession.id == session_id, DesignSession.recraft_used < budget)
        .values(recraft_used=DesignSession.recraft_used + 1)
    )
    if cast("CursorResult[Any]", claimed).rowcount == 0:
        raise ConflictError("모티프 생성 예산을 모두 사용했습니다", code="recraft_budget_exhausted")
    await session.commit()

    payload: dict[str, Any] = {
        "query": body.prompt,
        "motif_provenance": {"user_id": str(user.id), "session_id": str(session_id)},
    }
    if style_hint is not None:
        payload["style_hint"] = style_hint
    return await _shielded(
        _dispatch_motif_generation(
            payload=payload,
            request=request,
            session=session,
            session_id=session_id,
            user_id=user.id,
            name=body.prompt.strip()[:100],
        )
    )


async def _save_generated_motif(
    session: SessionDep, *, user_id: uuid.UUID, motif_id: str, name: str
) -> bool:
    """생성 결과를 내 모티프에 남긴다 — 적용하지 않아도 나중에 다시 고를 수 있게.

    한도 초과·저장 실패면 저장만 건너뛴다(생성 자체는 실패가 아니다).
    """
    existing, count = await _user_motif_link_state(session, user_id=user_id, motif_id=motif_id)
    saved = True
    if existing is None:
        if count >= MAX_USER_MOTIFS:
            saved = False
        else:
            session.add(UserMotif(user_id=user_id, motif_id=motif_id, name=name))
    try:
        await session.commit()
    except Exception:
        logger.warning("생성 모티프 저장 실패 — 생성 응답은 그대로 반환", exc_info=True)
        await session.rollback()
        return False
    return saved


async def _dispatch_motif_generation(
    *,
    payload: dict[str, Any],
    request: Request,
    session: SessionDep,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    name: str,
) -> MotifGenerateOut:
    """클라이언트가 끊겨도 선차감한 Recraft 예산을 정합하게 되돌린다 — 생성과 같은 기계."""
    try:
        response = await request.app.state.worker.motif_generate(payload)
        out = WorkerMotifGenerateOut.model_validate(response)
    except ValidationError as exc:
        await _release_recraft_budget(session, session_id)
        raise UpstreamError("모티프 생성 워커 응답 형식이 올바르지 않습니다") from exc
    except Exception:
        await _release_recraft_budget(session, session_id)
        raise
    if out.reused:
        # 래더 히트 — Recraft 미호출이므로 예산 환급 (멱등 재호출이 예산을 태우지 않게)
        await _release_recraft_budget(session, session_id)
    results = await _motif_results(
        session, [out.motif_id], user_id=user_id, allow_ids=(out.motif_id,)
    )
    if not results:
        raise UpstreamError("생성한 모티프를 카탈로그에서 찾을 수 없습니다")
    saved = await _save_generated_motif(
        session,
        user_id=user_id,
        motif_id=out.motif_id,
        name=name or results[0].name or "만든 모티프",
    )
    return MotifGenerateOut(
        request_id=out.request_id, reused=out.reused, motif=results[0], saved=saved
    )


@router.post("/design/sessions/{session_id}/motifs/activate", response_model=DesignGenerateOut)
async def activate_motif(
    session_id: uuid.UUID,
    body: MotifActivateRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> DesignGenerateOut:
    """모티프 슬롯 교체 — 모티프 id만 바뀐 결정론 재렌더라 모델 호출도 과금도 없다."""
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user.id))
    design_session = await session.scalar(
        select(DesignSession).where(DesignSession.id == session_id).with_for_update()
    )
    ensure_owner(design_session, user)
    assert design_session is not None
    if design_session.current_intent is None:
        raise ConflictError("먼저 디자인을 만들어 주세요", code="design_not_started")
    motif = await session.get(Motif, body.motif_id)
    if motif is None:
        raise DomainError("모티프를 찾을 수 없습니다", code="invalid_motif", status=404)
    await _ensure_motif_access(
        [motif.id],
        session=session,
        user_id=user.id,
        design_session_id=design_session.id,
    )
    now = datetime.now(UTC)
    await _recover_stale_active_generation(session, design_session, user.id, now)
    if design_session.active_generation_id is not None:
        await session.rollback()
        raise ConflictError("디자인 생성이 진행 중입니다", code="generation_in_progress")

    run_id = uuid.uuid4()
    payload: dict[str, Any] = {
        "run_id": str(run_id),
        "intent": design_session.current_intent,
        "motif_slot": {"slot": body.slot, "motif_id": motif.id},
    }
    if design_session.seed is not None:
        payload["seed"] = design_session.seed
    if design_session.colorway is not None:
        payload["colorway"] = design_session.colorway
    name = (
        await session.scalar(
            select(UserMotif.name).where(
                UserMotif.user_id == user.id,
                UserMotif.motif_id == motif.id,
            )
        )
        or motif.subject
    )
    design_session.active_generation_id = run_id
    design_session.active_generation_started_at = now
    design_session.context_version += 1
    await _append_turn(
        session,
        design_session.id,
        "user",
        DesignMotifActivateTurnPayload(run_id=run_id, slot=body.slot, motif_id=motif.id),
    )
    await session.commit()
    return await _shielded(
        _dispatch_motif_activation(
            payload=payload,
            request=request,
            session=session,
            user_id=user.id,
            design_session_id=design_session.id,
            run_id=run_id,
            summary=f"{name} 무늬로 바꿨습니다" if name else "무늬를 바꿨습니다",
        )
    )


async def _dispatch_motif_activation(
    *,
    payload: dict[str, Any],
    request: Request,
    session: SessionDep,
    user_id: uuid.UUID,
    design_session_id: uuid.UUID,
    run_id: uuid.UUID,
    summary: str,
) -> DesignGenerateOut:
    """토큰을 쓰지 않으므로 환불도 없다(charge_cost=0) — 실패 처리는 생성과 같은 기계."""
    try:
        response = await request.app.state.worker.generate(payload)
        try:
            out = WorkerDesignGenerateOut.model_validate(response)
        except ValidationError as exc:
            raise UpstreamError("이미지 워커 응답 형식이 올바르지 않습니다") from exc
        return await _finish_generation_success(
            session=session,
            user_id=user_id,
            design_session_id=design_session_id,
            run_id=run_id,
            out=out,
            summary=summary,
        )
    except (UpstreamError, WorkerRequestError, ConflictError) as exc:
        await _finish_generation_failure(
            session=session,
            user_id=user_id,
            design_session_id=design_session_id,
            run_id=run_id,
            charge_cost=0,
            stage=exc.stage or "generation",
            code=exc.code,
        )
        raise
    except Exception as exc:
        await _finish_generation_failure(
            session=session,
            user_id=user_id,
            design_session_id=design_session_id,
            run_id=run_id,
            charge_cost=0,
            stage="generation",
            code="generation_failed",
        )
        logger.warning("motif activation failed", exc_info=True)
        raise UpstreamError("모티프를 바꾸지 못했습니다") from exc


async def _release_recraft_budget(session: SessionDep, session_id: uuid.UUID) -> None:
    await session.execute(
        update(DesignSession)
        .where(DesignSession.id == session_id)
        .values(recraft_used=func.greatest(DesignSession.recraft_used - 1, 0))
    )
    await session.commit()


async def _append_turn(
    session: SessionDep, session_id: uuid.UUID, role: str, payload: BaseModel
) -> DesignSessionTurn:
    await advisory_xact_lock(session, f"design-session:{session_id}")
    next_seq = (
        await session.scalar(
            select(func.coalesce(func.max(DesignSessionTurn.seq), 0)).where(
                DesignSessionTurn.session_id == session_id
            )
        )
        or 0
    ) + 1
    turn = DesignSessionTurn(
        session_id=session_id,
        seq=next_seq,
        role=role,
        payload=payload.model_dump(mode="json"),
    )
    session.add(turn)
    await session.flush()
    return turn
