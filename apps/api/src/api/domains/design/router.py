"""디자인 세션 골격 — 세션 상태는 api 소유(LangGraph 대체), 워커 연동은 4단계.

recraft 예산은 Postgres 공유 카운터(recraft_used) — 인스턴스 수와 무관하게 동작
(ARCHITECTURE §7). finalize 제한은 계정당 24시간 윈도우 쿼터(quota.py) — 세션
카운터·건당 환불 없음. 턴 payload 스키마는 /design 신규 기획(5단계)에서 구체화.
"""

import asyncio
import base64
import binascii
import json
import logging
import math
import re
import unicodedata
import uuid
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
from db.models.seamless import Motif
from fastapi import APIRouter, Query, Request, Response
from obs import request_id_var
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)
from sqlalchemy import CursorResult, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from svg_safety import SanitizeError, sanitize_svg

from api.db import SessionDep, advisory_xact_lock
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

router = APIRouter(tags=["design"])
logger = logging.getLogger(__name__)
MAX_DESIGN_JSON_BYTES = 1_000_000
MAX_DESIGN_PROMPT_LENGTH = 4_000
MAX_DESIGN_PHOTOS = 5
MAX_DESIGN_MOTIFS = 2
MAX_USER_MOTIFS = 100
MAX_MOTIF_SVG_BYTES = 2_000_000
MAX_TEXT_MOTIF_LENGTH = 20
MAX_PROCESSED_PREVIEW_BYTES = 2_000_000
MAX_PROCESSED_PREVIEW_BASE64_CHARS = 2_666_668
MAX_DESIGN_IDEA_LENGTH = 180
SIGNED_INT64_MIN = -(2**63)
SIGNED_INT64_MAX = 2**63 - 1

ReferencePurpose = Literal["auto", "color_mood", "motif", "composition"]


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


class DesignSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    seed: int | None
    colorway: str | None
    registry_version: str | None
    current_intent: dict[str, Any] | None
    recraft_used: int
    created_at: datetime
    updated_at: datetime
    # 목록 전용 — 마지막 generate_request 턴의 프롬프트 (세션 구분용 요약)
    last_prompt: str | None = None
    # 단건 GET 전용 — 계정 쿼터 (목록은 null, 설정 부재 시에도 null)
    finalize_quota: FinalizeQuotaOut | None = None


class DesignSessionUpdateRequest(BaseModel):
    seed: SignedInt64 | None = None
    colorway: str | None = Field(default=None, max_length=100)
    current_intent: BoundedDesignJson | None = None


class DesignTurnCreateRequest(BaseModel):
    role: Literal["user", "assistant"]
    payload: BoundedDesignJson


class DesignTurnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    seq: int
    role: str
    payload: dict[str, Any]
    created_at: datetime
    attachments: list["DesignTurnAttachmentOut"] = Field(default_factory=list)


class DesignTurnAttachmentOut(BaseModel):
    kind: Literal["photo", "svg"]
    filename: str
    purpose: ReferencePurpose | None = None
    preview_url: str | None = None
    preview_svg: str | None = None


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
        if not all(math.isfinite(number) for number in value):
            raise ValueError("motif bbox must be finite")
        if value != (-0.5, -0.5, 0.5, 0.5):
            raise ValueError("motif bbox must use the normalized unit frame")
        return value

    @field_validator("anchor")
    @classmethod
    def _origin_anchor(cls, value: tuple[float, float]):
        if not all(math.isfinite(number) for number in value):
            raise ValueError("motif anchor must be finite")
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


class ReferenceImageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    upload_id: uuid.UUID
    purpose: ReferencePurpose = "auto"


def _normalize_hex(value: str) -> str:
    value = value.strip().upper()
    if re.fullmatch(r"#[0-9A-F]{3}", value):
        value = "#" + "".join(character * 2 for character in value[1:])
    if not re.fullmatch(r"#[0-9A-F]{6}", value):
        raise ValueError("colors must be #RGB or #RRGGBB")
    return value


class PaletteConstraint(BaseModel):
    model_config = ConfigDict(extra="forbid")

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


class PatternConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    motif_scale: Literal["auto", "small", "medium", "large"] = "auto"
    density: Literal["auto", "sparse", "medium", "dense"] = "auto"
    arrangement: Literal["auto", "lattice", "staggered", "scatter"] = "auto"
    direction: Literal["auto", "vertical", "horizontal", "diagonal"] = "auto"


class PaletteExtractRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

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


class TextMotifPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

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


class PhotoMotifPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

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


class DesignIdeasRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field("", max_length=MAX_DESIGN_PROMPT_LENGTH)
    reference_images: list[ReferenceImageRequest] = Field(
        default_factory=list, max_length=MAX_DESIGN_PHOTOS
    )
    user_motif_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_DESIGN_MOTIFS)
    palette: PaletteConstraint = Field(default_factory=PaletteConstraint)
    pattern_constraints: PatternConstraints = Field(default_factory=PatternConstraints)
    count: Literal[3, 4] = 4

    @model_validator(mode="after")
    def _valid_context(self) -> "DesignIdeasRequest":
        self.prompt = self.prompt.strip()
        upload_ids = [item.upload_id for item in self.reference_images]
        if len(set(upload_ids)) != len(upload_ids):
            raise ValueError("reference images must be distinct")
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


class WorkerCandidateOut(BaseModel):
    id: str
    design_index: int
    layout_id: str
    source_fidelity: str
    colorway_id: str
    seed: int
    svg: str
    png_object_key: str | None


class DesignGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: uuid.UUID | None = None
    prompt: str | None = Field(default=None, max_length=MAX_DESIGN_PROMPT_LENGTH)
    intent: BoundedDesignJson | None = None
    colorway: str | None = Field(default=None, max_length=100)
    seed: SignedInt64 | None = None
    candidate_count: int = Field(1, ge=1, le=8)  # 워커 경계와 동일 — 선검증으로 헛환불 방지
    reference_images: list[ReferenceImageRequest] = Field(
        default_factory=list, max_length=MAX_DESIGN_PHOTOS
    )
    user_motif_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_DESIGN_MOTIFS)
    palette: PaletteConstraint = Field(default_factory=PaletteConstraint)
    pattern_constraints: PatternConstraints = Field(default_factory=PatternConstraints)

    @model_validator(mode="after")
    def _valid_attachment_request(self) -> "DesignGenerateRequest":
        upload_ids = [item.upload_id for item in self.reference_images]
        if len(set(upload_ids)) != len(upload_ids):
            raise ValueError("reference images must be distinct")
        if len(set(self.user_motif_ids)) != len(self.user_motif_ids):
            raise ValueError("user motifs must be distinct")
        if self.prompt is not None and not self.prompt.strip():
            self.prompt = None
        if self.intent is not None and (
            self.prompt is not None or self.reference_images or self.user_motif_ids
        ):
            raise ValueError(
                "intent variation cannot include prompt, reference images, or user motifs"
            )
        if self.prompt is None and self.intent is None and not self.user_motif_ids:
            raise ValueError("prompt or SVG motif is required")
        if self.reference_images and self.session_id is None:
            raise ValueError("session_id is required when reference images are used")
        return self


class DesignGenerateOut(BaseModel):
    # Additive rolling-deploy bridge: old worker responses fall back to request_id correlation.
    generation_log_id: uuid.UUID | None = None
    request_id: str
    registry_version: str
    engine_version: str
    intents: list[dict[str, Any]]
    candidates: list[WorkerCandidateOut]
    warnings: list[str] = []


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
    colorway_id: str | None = Field(default=None, max_length=100)
    production_method: str | None = Field(default=None, max_length=100)
    dpi: int | None = None
    weave: str | None = Field(default=None, max_length=100)
    material_map: dict[ShortDesignString, ShortDesignString] | None = Field(
        default=None, max_length=100
    )
    texture_strength: float | None = Field(None, ge=0)
    relief_strength: float | None = Field(None, ge=0)


class GenerationJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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
            "image": await _reference_image_payload(image, "color_mood", request),
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
    payload["image"] = await _reference_image_payload(image, "motif", request)
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
    references = await _resolve_reference_images(
        body.reference_images,
        session=session,
        user_id=user.id,
        request=request,
        lock=False,
    )
    user_motifs = await _resolve_user_motifs(
        body.user_motif_ids,
        session=session,
        user_id=user.id,
    )
    payload = body.model_dump(exclude={"reference_images", "user_motif_ids"})
    payload["reference_images"] = [
        await _reference_image_payload(image, purpose, request) for image, purpose in references
    ]
    payload["motif_ids"] = [motif.id for _, motif in user_motifs]
    payload["motifs"] = [{"motif_id": motif.id, "name": link.name} for link, motif in user_motifs]
    try:
        out = DesignIdeasOut.model_validate(await request.app.state.worker.ideas(payload))
    except ValidationError as exc:
        raise UpstreamError("아이디어 워커 응답 형식이 올바르지 않습니다") from exc
    if len(out.ideas) != body.count:
        raise UpstreamError("아이디어 워커가 요청한 후보 수를 반환하지 않았습니다")
    return out


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

    await advisory_xact_lock(session, f"user-motif:{user.id}")
    existing = await session.scalar(
        select(UserMotif).where(
            UserMotif.user_id == user.id,
            UserMotif.motif_id == worker_out.motif_id,
        )
    )
    if existing is not None:
        motif = await session.get(Motif, worker_out.motif_id)
        if motif is None or motif.source != "user_upload":
            raise UpstreamError("가져온 모티프를 확인하지 못했습니다")
        return _user_motif_out(existing, motif)
    count = int(
        await session.scalar(
            select(func.count()).select_from(UserMotif).where(UserMotif.user_id == user.id)
        )
        or 0
    )
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
            embedding=None,
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
            .where(UserMotif.user_id == user.id, Motif.source == "user_upload")
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
    session_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> DesignSessionOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    out = DesignSessionOut.model_validate(design_session)
    # 표시용 쿼터 — 설정 행이 없으면 null로 둔다(페이지를 깨지 않음). 소유자 검증
    # 이후에 계산해 authz 403/404 순서를 보존한다.
    limit = await load_finalize_limit(session)
    if limit is not None:
        quota = await get_finalize_quota(session, user.id, limit)
        out = out.model_copy(
            update={
                "finalize_quota": FinalizeQuotaOut(
                    limit=quota.limit,
                    used=quota.used,
                    remaining=quota.remaining,
                    reset_at=quota.reset_at,
                )
            }
        )
    return out


@router.patch("/design/sessions/{session_id}", response_model=DesignSessionOut)
async def update_design_session(
    session_id: uuid.UUID,
    body: DesignSessionUpdateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> DesignSessionOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    if body.current_intent is not None:
        await _ensure_intent_motif_access(
            body.current_intent,
            session=session,
            user_id=user.id,
            design_session_id=design_session.id,
        )
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(design_session, field, value)
    await session.commit()
    await session.refresh(design_session)
    return DesignSessionOut.model_validate(design_session)


@router.delete("/design/sessions/{session_id}", status_code=204)
async def delete_design_session(
    session_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    """세션과 턴 이력을 삭제한다.

    finalize 결과물(generation_jobs)은 세션과 독립적인 사용자 소유 산출물이라
    남긴다(FK SET NULL) — 완성본 정리는 DELETE /design/jobs/{job_id}로.
    """
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    photo_ids = (
        select(DesignTurnAttachment.image_id)
        .join(
            DesignSessionTurn,
            DesignSessionTurn.id == DesignTurnAttachment.turn_id,
        )
        .where(
            DesignSessionTurn.session_id == session_id,
            DesignTurnAttachment.image_id.is_not(None),
        )
    )
    await session.execute(
        update(Image)
        .where(Image.id.in_(photo_ids))
        .values(expires_at=datetime.now(UTC), entity_type="design_reference_deleted")
    )
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


async def _design_turn_outs(
    turns: list[DesignSessionTurn],
    *,
    session: SessionDep,
    request: Request,
) -> list[DesignTurnOut]:
    by_turn: dict[uuid.UUID, list[DesignTurnAttachmentOut]] = {turn.id: [] for turn in turns}
    if turns:
        attachment_rows = (
            await session.execute(
                select(DesignTurnAttachment, Image, Motif)
                .outerjoin(Image, Image.id == DesignTurnAttachment.image_id)
                .outerjoin(Motif, Motif.id == DesignTurnAttachment.motif_id)
                .where(DesignTurnAttachment.turn_id.in_([turn.id for turn in turns]))
                .order_by(DesignTurnAttachment.turn_id, DesignTurnAttachment.ordinal)
            )
        ).all()
        now = datetime.now(UTC)
        eligible_photos = [
            (row_index, image.object_key)
            for row_index, (attachment, image, _motif) in enumerate(attachment_rows)
            if (
                attachment.kind == "photo"
                and image is not None
                and image.deleted_at is None
                and (image.expires_at is None or image.expires_at > now)
            )
        ]
        signed_photo_urls = await asyncio.gather(
            *(
                request.app.state.gcs.signed_read_url(object_key)
                for _row_index, object_key in eligible_photos
            )
        )
        preview_urls_by_row = {
            row_index: preview_url
            for (row_index, _object_key), preview_url in zip(
                eligible_photos, signed_photo_urls, strict=True
            )
        }
        for row_index, (attachment, _image, motif) in enumerate(attachment_rows):
            preview_url = preview_urls_by_row.get(row_index)
            preview_svg = None
            if attachment.kind == "svg" and motif is not None:
                preview_svg = _motif_preview_svg(motif)
            by_turn.setdefault(attachment.turn_id, []).append(
                DesignTurnAttachmentOut(
                    kind=attachment.kind,
                    filename=attachment.filename,
                    purpose=attachment.purpose,
                    preview_url=preview_url,
                    preview_svg=preview_svg,
                )
            )
    return [
        DesignTurnOut.model_validate(turn).model_copy(update={"attachments": by_turn[turn.id]})
        for turn in turns
    ]


@router.post("/design/sessions/{session_id}/turns", response_model=DesignTurnOut, status_code=201)
async def append_design_turn(
    session_id: uuid.UUID,
    body: DesignTurnCreateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> DesignTurnOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    await advisory_xact_lock(session, f"design-session:{session_id}")  # seq 직렬화
    next_seq = (
        await session.scalar(
            select(func.coalesce(func.max(DesignSessionTurn.seq), 0)).where(
                DesignSessionTurn.session_id == session_id
            )
        )
        or 0
    ) + 1
    turn = DesignSessionTurn(
        session_id=session_id, seq=next_seq, role=body.role, payload=body.payload
    )
    session.add(turn)
    await session.commit()
    await session.refresh(turn)
    return DesignTurnOut.model_validate(turn)


@router.post("/design/generate", response_model=DesignGenerateOut)
async def generate_design(
    body: DesignGenerateRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> DesignGenerateOut:
    design_session = None
    if body.session_id is not None:
        design_session = await session.get(DesignSession, body.session_id)
        ensure_owner(design_session, user)
    if body.intent is not None:
        await _ensure_intent_motif_access(
            body.intent,
            session=session,
            user_id=user.id,
            design_session_id=design_session.id if design_session is not None else None,
        )
    photos, user_motifs = await _resolve_generation_attachments(
        body, session=session, user_id=user.id, request=request
    )
    payload = body.model_dump(
        exclude={"session_id", "reference_images", "user_motif_ids"},
        exclude_none=True,
    )
    if photos:
        payload["reference_images"] = [
            await _reference_image_payload(image, purpose, request) for image, purpose in photos
        ]
    if user_motifs:
        payload["motif_ids"] = [motif.id for _, motif in user_motifs]

    # 클라이언트 연결이 끊겨도 과금 이후 worker→턴 기록/환불을 끝낸다. 취소된
    # 요청의 dependency teardown이 먼저 session을 닫지 않도록 inner task까지 기다린다.
    completion = asyncio.create_task(
        _complete_generation(
            body,
            payload,
            request,
            session,
            user.id,
            design_session,
            photos,
            user_motifs,
        )
    )
    try:
        return await asyncio.shield(completion)
    except asyncio.CancelledError:
        try:
            await completion
        except Exception:
            logger.warning("generation completion failed after client cancellation", exc_info=True)
        raise


async def _complete_generation(
    body: DesignGenerateRequest,
    payload: dict[str, Any],
    request: Request,
    session: SessionDep,
    user_id: uuid.UUID,
    design_session: DesignSession | None,
    photos: list[tuple[Image, ReferencePurpose]],
    user_motifs: list[tuple[UserMotif, Motif]],
) -> DesignGenerateOut:
    """과금부터 최종 기록까지 취소로 분리되지 않는 generate 완료 단위."""

    # 과금 — work_id는 서버 생성 (X-Request-ID는 클라이언트 제어 값이라 멱등 히트 악용 가능).
    # 선차감 후 워커 실패 시 환불 — 워커 422(잘못된 intent)도 환불되는 관대한 기본값.
    work_id = f"design_generate_{uuid.uuid4().hex}"
    charge = await ledger.use_tokens(session, user_id, work_id)
    if not charge.success:
        detail = (
            "환불 심사 중에는 생성할 수 없습니다"
            if charge.error == "refund_pending"
            else "디자인 토큰이 부족합니다"
        )
        raise DomainError(detail, code=charge.error or "insufficient_tokens")
    try:
        response = await request.app.state.worker.generate(payload)
        try:
            out = DesignGenerateOut.model_validate(response)
        except ValidationError as exc:
            raise UpstreamError("이미지 워커 응답 형식이 올바르지 않습니다") from exc
        if design_session is not None:
            design_session.registry_version = out.registry_version
            if body.intent is not None:
                design_session.current_intent = body.intent
            user_turn = await _append_turn(
                session,
                design_session.id,
                "user",
                {
                    "type": "generate_request",
                    "mode": "variation" if body.intent is not None else "prompt",
                    "prompt": body.prompt if body.intent is None else None,
                    "seed": body.seed,
                    "colorway": body.colorway,
                    "candidate_count": body.candidate_count,
                    "palette": body.palette.model_dump(),
                    "pattern_constraints": body.pattern_constraints.model_dump(),
                },
            )
            for ordinal, (image, purpose) in enumerate(photos):
                session.add(
                    DesignTurnAttachment(
                        turn_id=user_turn.id,
                        kind="photo",
                        image_id=image.id,
                        motif_id=None,
                        purpose=purpose,
                        filename=image.original_filename or f"참고 이미지 {ordinal + 1}",
                        ordinal=ordinal,
                    )
                )
                image.entity_type = "design_reference"
                image.entity_id = str(design_session.id)
                image.expires_at = None
            for index, (link, motif) in enumerate(user_motifs, start=len(photos)):
                session.add(
                    DesignTurnAttachment(
                        turn_id=user_turn.id,
                        kind="svg",
                        image_id=None,
                        motif_id=motif.id,
                        purpose=None,
                        filename=link.name,
                        ordinal=index,
                    )
                )
            await _append_turn(
                session,
                design_session.id,
                "assistant",
                {"type": "generate", "response": out.model_dump(mode="json")},
            )
        await session.commit()
    except (UpstreamError, WorkerRequestError):
        # 둘 다 환불하되 응답은 구분 — 요청 오류는 422(detail 보존), 일시 장애는 502.
        await session.rollback()
        await ledger.refund_failed_generation(session, user_id, charge.cost, work_id)
        raise
    except Exception as exc:
        # CancelledError(BaseException)는 여기서 삼키지 않는다. 일반 예외는 실패한
        # turn 트랜잭션을 정리한 뒤 환불해, 워커 프로토콜/DB 오류가 과금 누수로 번지지 않는다.
        await session.rollback()
        await ledger.refund_failed_generation(session, user_id, charge.cost, work_id)
        logger.warning("generation completion failed after charge", exc_info=True)
        raise UpstreamError("디자인 생성을 완료하지 못했습니다") from exc
    return out


async def _resolve_generation_attachments(
    body: DesignGenerateRequest,
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    request: Request,
) -> tuple[list[tuple[Image, ReferencePurpose]], list[tuple[UserMotif, Motif]]]:
    photos = await _resolve_reference_images(
        body.reference_images,
        session=session,
        user_id=user_id,
        request=request,
        lock=True,
    )
    motifs = await _resolve_user_motifs(
        body.user_motif_ids,
        session=session,
        user_id=user_id,
    )
    return photos, motifs


async def _resolve_reference_images(
    references: list[ReferenceImageRequest],
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    request: Request,
    lock: bool,
) -> list[tuple[Image, ReferencePurpose]]:
    if not references:
        return []
    upload_ids = [reference.upload_id for reference in references]
    query = select(Image).where(Image.id.in_(upload_ids)).order_by(Image.id)
    if lock:
        query = query.with_for_update()
    now = datetime.now(UTC)
    images_by_id = {image.id: image for image in await session.scalars(query)}
    resolved: list[tuple[Image, ReferencePurpose]] = []
    for reference in references:
        image = images_by_id.get(reference.upload_id)
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
                "유효하지 않은 디자인 참고 이미지입니다",
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
                    "디자인 참고 이미지를 확인하지 못했습니다",
                    code="invalid_design_reference",
                    status=409,
                )
        resolved.append((image, reference.purpose))
    return resolved


async def _resolve_staged_reference_image(
    upload_id: uuid.UUID,
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    request: Request,
) -> Image:
    resolved = await _resolve_reference_images(
        [ReferenceImageRequest(upload_id=upload_id)],
        session=session,
        user_id=user_id,
        request=request,
        lock=False,
    )
    return resolved[0][0]


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


def _intent_motif_ids(intent: object) -> set[str]:
    """Return the motif IDs consumed by the worker registry from an intent."""
    motif_ids: set[str] = set()
    if not isinstance(intent, dict):
        return motif_ids
    layers = intent.get("layers")
    if not isinstance(layers, list):
        return motif_ids
    for layer in layers:
        if not isinstance(layer, dict) or layer.get("type") != "motif":
            continue
        params = layer.get("params")
        motif_id = params.get("motif_id") if isinstance(params, dict) else None
        if isinstance(motif_id, str) and motif_id:
            motif_ids.add(motif_id)
    return motif_ids


async def _ensure_intent_motif_access(
    intent: object,
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    design_session_id: uuid.UUID | None,
) -> None:
    """Authorize private motif IDs exactly where the worker will resolve them.

    A current library link authorizes new use. A same-owner session attachment also
    authorizes replay after the user removes that motif from their library.
    """
    motif_ids = _intent_motif_ids(intent)
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
                DesignTurnAttachment.kind == "svg",
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
    purpose: ReferencePurpose,
    request: Request,
) -> dict[str, str | int]:
    assert image.content_type is not None
    assert image.size_bytes is not None
    return {
        "image_id": str(image.id),
        "url": await request.app.state.gcs.signed_read_url(image.object_key),
        "content_type": image.content_type,
        "size_bytes": image.size_bytes,
        "purpose": purpose,
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
        .values(status="failed", error_message=FINALIZE_DISPATCH_FAILED_MESSAGE)
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
        .values(status="canceled", result=None, error_message=FINALIZE_CANCELED_MESSAGE)
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
    object_key = job.result.get("object_key") if isinstance(job.result, dict) else None
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
    source_key = job.result.get("object_key") if isinstance(job.result, dict) else None
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


def _generation_job_out(job: GenerationJob, settings) -> GenerationJobOut:  # noqa: ANN001
    object_key = job.result.get("object_key") if isinstance(job.result, dict) else None
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


class MotifSpecIn(BaseModel):
    subject: str = Field(min_length=1, max_length=100)
    scope: str = Field(min_length=1, max_length=100)
    view: str | None = Field(default=None, max_length=100)
    expression: str | None = Field(default=None, max_length=100)
    style: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=1_000)


class MotifCandidatesRequest(BaseModel):
    spec: MotifSpecIn
    top_k: int = Field(5, ge=1, le=10)


class MotifCandidateOut(BaseModel):
    motif_id: str
    similarity: float | None
    subject: str | None = None
    scope: str | None = None
    view: str | None = None
    style: str | None = None
    description: str | None = None
    source: str | None = None


class MotifCandidatesOut(BaseModel):
    request_id: str
    registry_version: str
    candidates: list[MotifCandidateOut]


class MotifGenerateRequest(BaseModel):
    spec: MotifSpecIn
    seed: SignedInt64 | None = None


class MotifGenerateOut(BaseModel):
    request_id: str
    motif_id: str
    reused: bool
    similarity: float | None


@router.post(
    "/design/sessions/{session_id}/motifs/candidates",
    response_model=MotifCandidatesOut,
)
async def motif_candidates(
    session_id: uuid.UUID,
    body: MotifCandidatesRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> MotifCandidatesOut:
    """read-only 검색 — 워커가 Recraft를 호출하지 않으므로 예산 없음."""
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    response = await request.app.state.worker.motif_candidates(body.model_dump(exclude_none=True))
    return MotifCandidatesOut.model_validate(response)


@router.post(
    "/design/sessions/{session_id}/motifs/generate",
    response_model=MotifGenerateOut,
)
async def motif_generate(
    session_id: uuid.UUID,
    body: MotifGenerateRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> MotifGenerateOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
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

    try:
        response = await request.app.state.worker.motif_generate(body.model_dump(exclude_none=True))
        out = MotifGenerateOut.model_validate(response)
    except Exception:
        await _release_recraft_budget(session, session_id)
        raise
    if out.reused:
        # 래더 히트 — Recraft 미호출이므로 예산 환급 (멱등 재호출이 예산을 태우지 않게)
        await _release_recraft_budget(session, session_id)
    return out


async def _release_recraft_budget(session: SessionDep, session_id: uuid.UUID) -> None:
    await session.execute(
        update(DesignSession)
        .where(DesignSession.id == session_id)
        .values(recraft_used=func.greatest(DesignSession.recraft_used - 1, 0))
    )
    await session.commit()


async def _append_turn(
    session: SessionDep, session_id: uuid.UUID, role: str, payload: dict[str, Any]
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
    turn = DesignSessionTurn(session_id=session_id, seq=next_seq, role=role, payload=payload)
    session.add(turn)
    await session.flush()
    return turn
