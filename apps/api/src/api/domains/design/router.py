"""디자인 세션 — 템플릿에서 시작한 세션의 로고 교체와 사진→로고 미리보기.

상태는 api 소유, worker는 stateless 결정론 재렌더만 한다. 과금 없음.
"""

import asyncio
import base64
import binascii
import json
import logging
import uuid
from collections.abc import Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from db.models.design import (
    DesignExample,
    DesignSession,
    DesignSessionTurn,
    UserMotif,
)
from db.models.images import Image
from db.models.seamless import Motif, SeamlessGenerationLog
from fastapi import APIRouter, Request
from pydantic import (
    BaseModel,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)
from sqlalchemy import Select, func, select
from sqlalchemy import cast as sql_cast
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.dialects.postgresql import insert as pg_insert
from svg_safety import SanitizeError, sanitize_svg

from api.db import USER_LOCK, SessionDep, advisory_xact_lock
from api.deps import CurrentUser, ensure_owner
from api.domains.images.service import MAX_ORDER_IMAGE_BYTES
from api.errors import ConflictError, DomainError, UpstreamError, WorkerRequestError
from api.schemas import ORMModel, StrictModel

router = APIRouter(tags=["design"])
logger = logging.getLogger(__name__)
MAX_DESIGN_JSON_BYTES = 1_000_000
MAX_DESIGN_MOTIFS = 2
MAX_USER_MOTIFS = 100
MAX_MOTIF_SVG_BYTES = 2_000_000
MAX_PROCESSED_PREVIEW_BYTES = 2_000_000
MAX_PROCESSED_PREVIEW_BASE64_CHARS = 2_666_668
SIGNED_INT64_MIN = -(2**63)
SIGNED_INT64_MAX = 2**63 - 1
# 외부 호출 lease를 넘긴 채 종결되지 못한 세션 생성을 회수하는 TTL
# (_recover_stale_active_generation).
STALE_GENERATION_JOB_AFTER = timedelta(minutes=75)


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


SignedInt64 = Annotated[int, Field(ge=SIGNED_INT64_MIN, le=SIGNED_INT64_MAX)]


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
    context_version: int
    active_generation_id: uuid.UUID | None
    active_generation_started_at: datetime | None
    # 시작한 템플릿(예시) — store가 포인트 위치·로고 슬롯을 템플릿 목록에서 찾는 키.
    example_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    # 편집 포인터(마지막 activate 턴)의 디자인 SVG — 목록 썸네일과 단건의 현재 디자인.
    preview_svg: str | None = None
    # 같은 런의 배치형(panel) SVG — 블레이드에 한 번 얹는 요소. 없으면 null.
    preview_panel_svg: str | None = None
    # 단건 GET·스텝 이동 전용 — current_intent의 모티프 슬롯(최대 2, 슬롯 순서). 목록은 빈 배열.
    current_motifs: list[CurrentMotifOut] = Field(default_factory=list)


class UserMotifImportRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    svg: str = Field(max_length=MAX_MOTIF_SVG_BYTES)

    @field_validator("svg")
    @classmethod
    def _bounded_svg_bytes(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_MOTIF_SVG_BYTES:
            raise ValueError(f"SVG exceeds {MAX_MOTIF_SVG_BYTES} bytes")
        return value


LogoSlot = Literal[1, 2, "logo"]


class DesignLogoSlotOut(BaseModel):
    """템플릿의 로고 자리 하나 — 1|2는 intent 모티프 레이어 순서, "logo"는 배치형 포인트 로고."""

    slot: LogoSlot
    # 업로드 칸 이름(예: "포인트 로고") — 없으면 store가 순번으로 부른다.
    label: str | None = None


class DesignLogoPlaceRequest(UserMotifImportRequest):
    # 템플릿 로고 자리 중 하나 — 생략하면 첫 자리.
    slot: LogoSlot | None = None


class WorkerMotifImportOut(BaseModel):
    motif_id: str = Field(pattern=r"^upload-[0-9a-f]{12}$")
    symbol: str = Field(max_length=MAX_MOTIF_SVG_BYTES)
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


class PhotoMotifPreviewRequest(StrictModel):
    upload_id: uuid.UUID


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


class DesignOut(BaseModel):
    id: str
    layout_id: str
    source_fidelity: str
    colorway_id: str
    seed: int
    svg: str
    png_object_key: str | None
    # 배치형(panel) 요소 SVG — 블레이드 프레임(viewBox 0 -4600 1000 6200, 어깨선 y=1000).
    panel_svg: str | None = None

    @field_validator("panel_svg")
    @classmethod
    def _safe_panel_svg(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return sanitize_svg(value)
        except SanitizeError as exc:
            raise ValueError("worker returned unsafe panel svg") from exc


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
    # "logo" = 배치형(panel) 포인트 로고 자리 — 로고 넣기만 보낸다.
    slot: Literal[1, 2, "logo"]
    motif_id: str = Field(min_length=1, max_length=100)


@dataclass(frozen=True)
class _ResolvedDesignRun:
    log: SeamlessGenerationLog
    intent: dict[str, Any]
    # 최초 저작 런만 plan을 남긴다. 구성 patch 런은 None.
    plan: dict[str, Any] | None
    seed: int
    colorway_id: str


def _motif_preview_svg(motif: Motif) -> str:
    try:
        symbol = sanitize_svg(motif.symbol)
    except SanitizeError as exc:
        raise DomainError("모티프 SVG가 안전하지 않습니다", code="unsafe_motif_svg") from exc
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.6 -0.6 1.2 1.2" '
        'preserveAspectRatio="xMidYMid meet">'
        f"<defs>{symbol}</defs>"
        f'<use href="#motif-{motif.id}"/>'
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


def _pointer_svg_query(
    session_id: Any, key: Literal["svg", "panel_svg"] = "svg"
) -> Select[tuple[str | None]]:
    """편집 포인터(마지막 activate 턴)의 런이 남긴 디자인 SVG — 목록·단건이 같은 출처를 쓴다."""
    return (
        select(SeamlessGenerationLog.design[key].astext)
        .select_from(DesignSessionTurn)
        .join(
            SeamlessGenerationLog,
            SeamlessGenerationLog.id
            == sql_cast(DesignSessionTurn.payload["run_id"].astext, PgUUID),
        )
        .where(
            DesignSessionTurn.session_id == session_id,
            DesignSessionTurn.payload["type"].astext == "activate",
        )
        .order_by(DesignSessionTurn.seq.desc())
        .limit(1)
    )


async def _design_session_out(
    session: SessionDep,
    design_session: DesignSession,
) -> DesignSessionOut:
    """세션 응답 + 현재 디자인 SVG + 모티프 슬롯(카탈로그 포함, 최대 2)."""

    out = DesignSessionOut.model_validate(design_session).model_copy(
        update={
            "preview_svg": await session.scalar(_pointer_svg_query(design_session.id)),
            "preview_panel_svg": await session.scalar(
                _pointer_svg_query(design_session.id, "panel_svg")
            ),
        }
    )
    motif_ids = _intent_slot_motif_ids(design_session.current_intent)[:MAX_DESIGN_MOTIFS]
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


async def _user_motif_link_state(
    session: SessionDep, *, user_id: uuid.UUID, motif_id: str
) -> tuple[UserMotif | None, int]:
    """user-motif 락을 잡고 기존 링크·보유 수를 읽는다."""
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
            bbox=list(worker_out.bbox),
            anchor=list(worker_out.anchor),
            subject="user upload",
            scope="whole",
            style=None,
            description=None,
            tags=[],
            source="user_upload",
            # ponytail: 비공개(user_upload)라 게이트 무관 — pending 큐 오염 방지용 approved.
            status="approved",
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    motif = await session.get(Motif, worker_out.motif_id)
    if (
        motif is None
        or motif.source != "user_upload"
        or motif.symbol != worker_out.symbol
        or list(motif.bbox) != list(worker_out.bbox)
        or list(motif.anchor) != list(worker_out.anchor)
    ):
        raise UpstreamError("가져온 모티프를 확인하지 못했습니다")
    link = UserMotif(user_id=user.id, motif_id=motif.id, name=name)
    session.add(link)
    await session.commit()
    await session.refresh(link)
    return _user_motif_out(link, motif)


@router.get("/design/sessions/{session_id}", response_model=DesignSessionOut)
async def get_design_session(
    session_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> DesignSessionOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    return await _design_session_out(session, design_session)


def _logged_design(log: SeamlessGenerationLog) -> dict[str, Any] | None:
    """워커 로그가 보관한 단일 디자인 — 생성 1회 = 디자인 1개."""
    return log.design if isinstance(log.design, dict) else None


async def _shielded[ResultT](coro: Coroutine[Any, Any, ResultT]) -> ResultT:
    """클라이언트가 끊겨도 시작한 재렌더는 끝까지 마무리한다 — 턴·포인터를 정합하게 남긴다."""

    completion = asyncio.create_task(coro)
    try:
        return await asyncio.shield(completion)
    except asyncio.CancelledError:
        try:
            await completion
        except Exception:
            logger.warning("generation completion failed after client cancellation", exc_info=True)
        raise


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
    )
    summary = summary or _short_design_description(out.plan)
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


def _panel_motifs(intent: object) -> list[dict[str, Any]]:
    panel = intent.get("panel") if isinstance(intent, dict) else None
    return [
        element
        for element in (panel if isinstance(panel, list) else ())
        if isinstance(element, dict)
        and element.get("type") == "motif"
        and isinstance(element.get("motif_id"), str)
        and element["motif_id"]
    ]


def _panel_logo_motif_id(intent: object) -> str | None:
    """배치형(panel) 포인트 로고의 모티프 id — worker `engine.panel.panel_logo`와 같은 규칙."""
    return next((e["motif_id"] for e in _panel_motifs(intent) if e.get("role") == "logo"), None)


def _logo_slots(logo_slots: object, intent: object) -> list[DesignLogoSlotOut]:
    """로고를 받을 자리 — 템플릿 `logo_slots`가 있으면 그대로, 없으면 서버 규칙 한 자리
    (배치형 포인트 로고 → 모티프 레이어가 둘이면 2(큰 무늬) → 1)."""
    if isinstance(logo_slots, list) and logo_slots:
        return [DesignLogoSlotOut.model_validate(item) for item in logo_slots]
    slot: LogoSlot = (
        "logo"
        if _panel_logo_motif_id(intent) is not None
        else 2
        if len(_intent_slot_motif_ids(intent)) >= 2
        else 1
    )
    return [DesignLogoSlotOut(slot=slot)]


def _all_intent_motif_ids(intent: object) -> list[str]:
    """워커가 해석할 모티프 전부 — 레이어 + 배치형(panel). 접근 검사는 이 범위로 한다."""
    ids = dict.fromkeys(_intent_motif_ids(intent))
    ids.update(dict.fromkeys(e["motif_id"] for e in _panel_motifs(intent)))
    return list(ids)


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


def _intent_slot_motif_ids(intent: object) -> list[str]:
    """슬롯 순서(1, 2, …)의 모티프 id — 슬롯 번호는 worker `patch.motif_layer_slots`와 같은 규칙:
    레이어에 박힌 `slot`이 우선, 없으면 고유 motif_id가 처음 나오는 순서. 두 슬롯이 같은 모티프면
    같은 id가 두 번 나온다."""
    layers = intent.get("layers") if isinstance(intent, dict) else None
    motifs = [
        layer
        for layer in layers or []
        if isinstance(layer, dict)
        and layer.get("type") == "motif"
        and isinstance(layer.get("params"), dict)
    ]
    next_slot = max((m["slot"] for m in motifs if isinstance(m.get("slot"), int)), default=0)
    by_motif: dict[object, int] = {}
    by_slot: dict[int, str] = {}
    for layer in motifs:
        motif_id = layer["params"].get("motif_id")
        slot = layer.get("slot")
        if not isinstance(slot, int):
            if motif_id not in by_motif:
                next_slot += 1
                by_motif[motif_id] = next_slot
            slot = by_motif[motif_id]
        if isinstance(motif_id, str) and motif_id:
            by_slot.setdefault(slot, motif_id)
    return [by_slot[slot] for slot in sorted(by_slot)]


async def _ensure_intent_motif_access(
    intent: object,
    *,
    session: SessionDep,
    user_id: uuid.UUID,
) -> None:
    await _ensure_motif_access(
        _all_intent_motif_ids(intent),
        session=session,
        user_id=user_id,
    )


async def _ensure_motif_access(
    motif_ids: list[str],
    *,
    session: SessionDep,
    user_id: uuid.UUID,
) -> None:
    """Authorize private motif IDs exactly where the worker will resolve them.

    Only a current library link authorizes use.
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


async def _activate_motif_slot(
    session_id: uuid.UUID,
    slot: Literal[1, 2, "logo"],
    motif_id: str,
    *,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> DesignGenerateOut:
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user.id))
    design_session = await session.scalar(
        select(DesignSession).where(DesignSession.id == session_id).with_for_update()
    )
    ensure_owner(design_session, user)
    assert design_session is not None
    if design_session.current_intent is None:
        raise ConflictError("먼저 디자인을 만들어 주세요", code="design_not_started")
    motif = await session.get(Motif, motif_id)
    if motif is None:
        raise DomainError("모티프를 찾을 수 없습니다", code="invalid_motif", status=404)
    await _ensure_motif_access(
        [motif.id],
        session=session,
        user_id=user.id,
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
        "motif_slot": {"slot": slot, "motif_id": motif.id},
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
        DesignMotifActivateTurnPayload(run_id=run_id, slot=slot, motif_id=motif.id),
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


@router.post("/design/sessions/{session_id}/logo", response_model=DesignGenerateOut)
async def place_design_logo(
    session_id: uuid.UUID,
    body: DesignLogoPlaceRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> DesignGenerateOut:
    """로고 한 번에 넣기 — 내 모티프 저장(멱등) + 로고 슬롯 교체 재렌더. 무과금.

    자리는 템플릿의 `logo_slots` 중 하나(`slot`, 생략하면 첫 자리)다. 템플릿이 자리를
    정하지 않았으면 서버 규칙 한 자리: 배치형(panel) 포인트 로고가 있으면 `"logo"`, 모티프
    레이어가 둘이면 2, 아니면 1.
    """
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    if design_session.current_intent is None:
        raise ConflictError("먼저 디자인을 만들어 주세요", code="design_not_started")
    # 렌더 도중 죽은 프로세스가 남긴 진행 표시는 여기서 풀어야 영구 409가 되지 않는다.
    await _recover_stale_active_generation(session, design_session, user.id, datetime.now(UTC))
    if design_session.active_generation_id is not None:
        raise ConflictError("디자인 생성이 진행 중입니다", code="generation_in_progress")
    example = (
        await session.get(DesignExample, design_session.example_id)
        if design_session.example_id is not None
        else None
    )
    slots: list[LogoSlot] = [
        item.slot
        for item in _logo_slots(
            example.logo_slots if example is not None else None, design_session.current_intent
        )
    ]
    slot = slots[0] if body.slot is None else body.slot
    if slot not in slots:
        raise DomainError("이 템플릿에 없는 로고 자리입니다", code="invalid_logo_slot", status=422)
    saved = await import_user_motif(body, request, session, user)
    return await _activate_motif_slot(
        session_id, slot, saved.motif_id, request=request, session=session, user=user
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
    """로고 교체 결정론 재렌더 — 무과금. 실패면 오류 턴을 남기고 진행 표시를 푼다."""
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
            stage="generation",
            code="generation_failed",
        )
        logger.warning("motif activation failed", exc_info=True)
        raise UpstreamError("모티프를 바꾸지 못했습니다") from exc


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
