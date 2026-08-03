"""관리자 생성 운영·Motif 읽기 전용 projection.

목록은 raw prompt/SVG/사용자 식별자/object key를 절대 반환하지 않는다. 상세 조회는
저장된 prompt 원문, allowlist로 투영한 intent와 worker 공유 sanitizer를 다시 통과한
SVG만 노출한다.
"""

import math
import re
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal, NamedTuple, cast, get_args

from db.models.auth import User
from db.models.design import DesignSession, DesignSessionTurn, GenerationJob
from db.models.seamless import Motif, SeamlessGenerationLog
from db.models.tokens import DesignToken
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, func, or_, select
from svg_safety import SanitizeError, sanitize_svg

from api.db import SessionDep
from api.deps import AdminUser, SettingsDep
from api.domains.admin.helpers import kst_day_bounds
from api.domains.admin.schemas import Page
from api.errors import DomainError, NotFoundError
from api.integrations.gcs import public_asset_url

router = APIRouter(prefix="/admin", tags=["admin-generation"])

JobKind = Literal["finalize", "export"]
JobStatus = Literal["queued", "processing", "succeeded", "failed", "canceled"]
SeamlessStatus = Literal["success", "partial", "error"]
SvgStatus = Literal["safe", "unavailable", "unsafe"]
# 워커의 `_logged_generation`이 기록하는 4종 (worker/api/routes.py)
GenerationMode = Literal["prompt", "patch", "variation", "motif_slot"]
GENERATION_MODES = frozenset(get_args(GenerationMode))
WarningCode = Literal[
    "cmyk_gamut",
    "generation_warning",
    "motif_layer_dropped",
    "preview_unavailable",
    "spacing_snap",
    "stripe_period_snap",
]
DEFAULT_LIMIT = 20
MAX_LIMIT = 100
_SAFE_TOKEN = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
_CONTENT_KEY = re.compile(r"^fabric/[0-9a-f]{16}\.png$")
_EMAIL = re.compile(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b")
_PHONE = re.compile(r"(?<!\d)\d[\d -]{7,}\d(?!\d)")
_URL_OR_PATH = re.compile(r"(?:https?://|gs://|/[A-Za-z0-9_.-]+/)", re.IGNORECASE)
_HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")
_CMYK_WARNING = re.compile(
    r"^color (#[0-9A-Fa-f]{6}) in colorway '[^']+' likely outside CMYK gamut$"
)
_MOTIF_DROP_WARNING = re.compile(
    r"^motif layer '[^']+' dropped — Tier-1 gate exhausted \((.+)/(whole|partial)\)$"
)
_INTENT_ALLOWED_KEYS = frozenset(
    {
        "intent_version",
        "canvas",
        "tile_mm",
        "dpi",
        "seed",
        "production",
        "method",
        "max_colors",
        "palette",
        "slots",
        "id",
        "hex",
        "spot",
        "name",
        "colorways",
        "mapping",
        "layers",
        "type",
        "params",
        "z_order",
        "opacity",
        "clip",
        "color",
        "angle",
        "period_mm",
        "bands",
        "offset_mm",
        "width_mm",
        "motif_id",
        "size_mm",
        "placement",
        "host_layer",
        "lane",
        "path",
        "kind",
        "wavelength",
        "amplitude",
        "spacing_mm",
        "phase_mm",
        "rotation",
        "fixed_rotation_deg",
        "lattice",
        "cell_w_mm",
        "cell_h_mm",
        "drop_fraction",
        "drop_axis",
        "scatter",
        "mode",
        "min_dist_mm",
        "count",
        "sateen_n",
        "sateen_step",
        "point_set",
        "points",
    }
)
_INTENT_DYNAMIC_MAP_KEYS = frozenset({"mapping"})
_INTENT_OMIT = object()
_MAX_INTENT_SEQUENCE = 10_000
_MAX_INTENT_DEPTH = 12


class GenerationJobStatsOut(BaseModel):
    total: int
    queued: int
    processing: int
    succeeded: int
    failed: int
    canceled: int
    average_attempts: float
    as_of: datetime


class GenerationJobSummaryOut(BaseModel):
    id: uuid.UUID
    kind: JobKind
    status: JobStatus
    attempts: int
    request_id: str | None
    result_available: bool
    error_summary: str | None
    created_at: datetime
    updated_at: datetime


class GenerationJobDetailOut(GenerationJobSummaryOut):
    session_id: uuid.UUID | None
    owner_reference: str
    parameter_summary: dict[str, Any]
    result_url: str | None


class SeamlessStatsOut(BaseModel):
    total: int
    success: int
    partial: int
    error: int
    average_generate_ms: float | None
    average_render_ms: float | None
    as_of: datetime


class SeamlessSummaryOut(BaseModel):
    id: uuid.UUID
    request_id: str | None
    input_type: str
    status: SeamlessStatus
    warning_count: int
    generate_ms: float | None
    render_ms: float | None
    engine_version: str | None
    registry_version: str | None
    error_type: str | None
    error_summary: str | None
    failure_code: str | None
    failure_stage: str | None
    created_at: datetime


class SafeDesignOut(BaseModel):
    id: str | None
    layout_id: str | None
    source_fidelity: str | None
    colorway_id: str | None
    seed: int | None
    svg: str | None
    svg_status: SvgStatus


class SeamlessWarningOut(BaseModel):
    code: WarningCode
    count: int
    items: list[str] = Field(default_factory=list)


class MotifResolutionOut(BaseModel):
    layer_id: str | None = None
    subject: str | None = None
    scope: str | None = None
    outcome: str | None = None
    motif_id: str | None = None
    similarity: float | None = None
    match_type: str | None = None
    provider: str | None = None
    operation: str | None = None
    reason_code: str | None = None
    status_code: int | None = None


class GenerationOutcomeOut(BaseModel):
    session_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    user_name: str | None = None
    # 이력 썸네일로 이 스텝을 다시 편집 포인터로 삼았는지 (steps/activate 턴)
    reactivated: bool = False
    regenerated: bool = False
    finalized: bool = False


class GenerationTokenAccountingOut(BaseModel):
    matched: bool
    debited: int
    refunded: int
    net: int


class GenerationDiagnosticsOut(BaseModel):
    mode: GenerationMode | None = None
    model: str | None = None
    prompt_revision: str | None = None
    # 구성 수정에서 실제로 바뀐 축 — patch 런에서만 채워진다.
    patch_axes: list[str] = Field(default_factory=list)
    authoring_attempts: int | None = None
    catalog_candidate_count: int | None = None
    resolved_count: int | None = None
    authoring_ms: float | None = None
    compose_ms: float | None = None
    render_ms: float | None = None
    failure_code: str | None = None
    failure_stage: str | None = None
    failure_provider: str | None = None
    failure_operation: str | None = None
    failure_reason: str | None = None
    failure_status_code: int | None = None
    motif_resolutions: list[MotifResolutionOut] = Field(default_factory=list)


class SeamlessDetailOut(SeamlessSummaryOut):
    has_prompt: bool
    prompt: str | None
    intent: dict[str, Any] | None
    seed: int | None
    warning_groups: list[SeamlessWarningOut]
    diagnostics: GenerationDiagnosticsOut
    outcome: GenerationOutcomeOut
    token_accounting: GenerationTokenAccountingOut
    design: SafeDesignOut | None


class MotifSummaryOut(BaseModel):
    id: str
    subject: str | None
    scope: str | None
    view: str | None
    expression: str | None
    style: str | None
    source: str
    quality: float | None
    variant_group: str | None
    created_at: datetime
    bbox: list[float]
    symbol: str | None
    svg_status: SvgStatus


class MotifDetailOut(MotifSummaryOut):
    description: str | None
    tags: list[str]
    anchor: list[float]


def _validate_range(start: datetime | None, end: datetime | None) -> None:
    if any(value is not None and value.tzinfo is None for value in (start, end)):
        raise DomainError("기간에는 시간대를 포함해야 합니다", code="invalid_period")
    if start is not None and end is not None and start > end:
        raise DomainError("시작 시각은 종료 시각보다 늦을 수 없습니다", code="invalid_period")


def _period_filters(column, start: datetime | None, end: datetime | None):
    _validate_range(start, end)
    filters: list[ColumnElement[bool]] = []
    if start is not None:
        filters.append(column >= start)
    if end is not None:
        filters.append(column <= end)
    return filters


def _safe_token(value: Any) -> str | None:
    return value if isinstance(value, str) and _SAFE_TOKEN.fullmatch(value) else None


def _safe_metadata(value: Any, *, limit: int = 160) -> str | None:
    if not isinstance(value, str):
        return None
    clean = " ".join(value.split())[:limit]
    if not clean or _EMAIL.search(clean) or _PHONE.search(clean) or _URL_OR_PATH.search(clean):
        return None
    return clean


def _safe_intent_value(value: Any, *, key: str | None = None, depth: int = 0) -> Any:
    if depth > _MAX_INTENT_DEPTH:
        return _INTENT_OMIT
    if value is None:
        return None
    if isinstance(value, bool):
        return _INTENT_OMIT
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else _INTENT_OMIT
    if isinstance(value, str):
        if key == "hex":
            return value if _HEX_COLOR.fullmatch(value) else _INTENT_OMIT
        safe = _safe_metadata(value) if key in {"name", "spot"} else _safe_token(value)
        return safe if safe is not None else _INTENT_OMIT
    if isinstance(value, list):
        if len(value) > _MAX_INTENT_SEQUENCE:
            return _INTENT_OMIT
        projected_items: list[Any] = []
        for item in value:
            projected = _safe_intent_value(item, key=key, depth=depth + 1)
            if projected is not _INTENT_OMIT:
                projected_items.append(projected)
        return projected_items
    if not isinstance(value, dict):
        return _INTENT_OMIT

    projected_fields: dict[str, Any] = {}
    for raw_key, item in value.items():
        if not isinstance(raw_key, str):
            continue
        if key in _INTENT_DYNAMIC_MAP_KEYS:
            safe_key = _safe_token(raw_key)
            if safe_key is None or not isinstance(item, str):
                continue
            if key == "mapping":
                if _HEX_COLOR.fullmatch(item):
                    projected_fields[safe_key] = item
            elif (safe_value := _safe_token(item)) is not None:
                projected_fields[safe_key] = safe_value
            continue
        if raw_key not in _INTENT_ALLOWED_KEYS:
            continue
        projected = _safe_intent_value(item, key=raw_key, depth=depth + 1)
        if projected is not _INTENT_OMIT:
            projected_fields[raw_key] = projected
    return projected_fields


def _safe_intent(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    projected = _safe_intent_value(value.get("design"))
    return projected if isinstance(projected, dict) and projected else None


def _number_list(value: Any, *, size: int) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != size:
        return []
    if not all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value):
        return []
    return [float(item) for item in value]


def _milliseconds(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def _job_filters(
    *,
    job_id: uuid.UUID | None,
    kind: JobKind | None,
    status: JobStatus | None,
    user_id: uuid.UUID | None,
    start: datetime | None,
    end: datetime | None,
) -> list[ColumnElement[bool]]:
    filters = _period_filters(GenerationJob.created_at, start, end)
    if job_id is not None:
        filters.append(GenerationJob.id == job_id)
    if kind is not None:
        filters.append(GenerationJob.kind == kind)
    if status is not None:
        filters.append(GenerationJob.status == status)
    if user_id is not None:
        filters.append(GenerationJob.user_id == user_id)
    return filters


class FinalizeDuration(NamedTuple):
    average: float | None
    p50: float | None
    p95: float | None


async def finalize_duration_seconds(
    session,  # noqa: ANN001 — SessionDep 전달
    *,
    start: datetime | None = None,
    end: datetime | None = None,
) -> FinalizeDuration:
    """성공한 finalize job의 실제 소요 시간(초) 분포. 화면 노출은 별도 작업."""
    elapsed = func.extract("epoch", GenerationJob.finished_at - GenerationJob.started_at)
    row = (
        await session.execute(
            select(
                func.avg(elapsed),
                func.percentile_cont(0.5).within_group(elapsed),
                func.percentile_cont(0.95).within_group(elapsed),
            ).where(
                *_period_filters(GenerationJob.created_at, start, end),
                GenerationJob.kind == "finalize",
                GenerationJob.status == "succeeded",
                GenerationJob.started_at.is_not(None),
                GenerationJob.finished_at.is_not(None),
            )
        )
    ).one()
    return FinalizeDuration(*(float(value) if value is not None else None for value in row))


def _job_summary(job: GenerationJob) -> GenerationJobSummaryOut:
    return GenerationJobSummaryOut(
        id=job.id,
        kind=cast("JobKind", job.kind),
        status=cast("JobStatus", job.status),
        attempts=job.attempts,
        request_id=_safe_token(job.request_id),
        result_available=isinstance(job.result, dict) and bool(job.result),
        error_summary="생성 작업에 실패했습니다" if job.status == "failed" else None,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _parameter_summary(params: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {"has_intent": isinstance(params.get("intent"), dict)}
    for key in ("dpi", "texture_strength", "relief_strength"):
        value = params.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            summary[key] = value
    for key in ("production_method", "weave"):
        if (value := _safe_token(params.get(key))) is not None:
            summary[key] = value
    return summary


def _result_url(job: GenerationJob, settings) -> str | None:  # noqa: ANN001 — SettingsDep
    if not isinstance(job.result, dict):
        return None
    object_key = job.result.get("object_key")
    if not isinstance(object_key, str) or not _CONTENT_KEY.fullmatch(object_key):
        return None
    return public_asset_url(settings, object_key)


@router.get("/generation/jobs/stats", response_model=GenerationJobStatsOut)
async def get_admin_generation_job_stats(
    session: SessionDep,
    admin: AdminUser,
    job_id: uuid.UUID | None = None,
    kind: JobKind | None = None,
    status: JobStatus | None = None,
    user_id: uuid.UUID | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
) -> GenerationJobStatsOut:
    filters = _job_filters(
        job_id=job_id,
        kind=kind,
        status=status,
        user_id=user_id,
        start=start,
        end=end,
    )
    row = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(GenerationJob.status == "queued"),
                func.count().filter(GenerationJob.status == "processing"),
                func.count().filter(GenerationJob.status == "succeeded"),
                func.count().filter(GenerationJob.status == "failed"),
                func.count().filter(GenerationJob.status == "canceled"),
                func.coalesce(func.avg(GenerationJob.attempts), 0),
            ).where(*filters)
        )
    ).one()
    return GenerationJobStatsOut(
        total=int(row[0]),
        queued=int(row[1]),
        processing=int(row[2]),
        succeeded=int(row[3]),
        failed=int(row[4]),
        canceled=int(row[5]),
        average_attempts=float(row[6]),
        as_of=datetime.now(UTC),
    )


@router.get("/generation/jobs", response_model=Page[GenerationJobSummaryOut])
async def list_admin_generation_jobs(
    session: SessionDep,
    admin: AdminUser,
    job_id: uuid.UUID | None = None,
    kind: JobKind | None = None,
    status: JobStatus | None = None,
    user_id: uuid.UUID | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[GenerationJobSummaryOut]:
    filters = _job_filters(
        job_id=job_id,
        kind=kind,
        status=status,
        user_id=user_id,
        start=start,
        end=end,
    )
    total = int(
        await session.scalar(select(func.count()).select_from(GenerationJob).where(*filters)) or 0
    )
    rows = await session.scalars(
        select(GenerationJob)
        .where(*filters)
        .order_by(GenerationJob.created_at.desc(), GenerationJob.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return Page(
        items=[_job_summary(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/generation/jobs/{job_id}", response_model=GenerationJobDetailOut)
async def get_admin_generation_job(
    job_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    settings: SettingsDep,
) -> GenerationJobDetailOut:
    job = await session.get(GenerationJob, job_id)
    if job is None:
        raise NotFoundError("생성 작업을 찾을 수 없습니다")
    summary = _job_summary(job)
    return GenerationJobDetailOut(
        **summary.model_dump(),
        session_id=job.session_id,
        owner_reference=f"…{str(job.user_id)[-8:]}",
        parameter_summary=_parameter_summary(job.params),
        result_url=_result_url(job, settings),
    )


def _seamless_filters(
    *,
    status: SeamlessStatus | None,
    request_id: str | None,
    identifier: str | None,
    start: datetime | None,
    end: datetime | None,
) -> list[ColumnElement[bool]]:
    filters = _period_filters(SeamlessGenerationLog.created_at, start, end)
    if status is not None:
        filters.append(SeamlessGenerationLog.status == status)
    if request_id is not None:
        clean = _safe_token(request_id)
        if clean is None:
            raise DomainError("request_id 형식이 올바르지 않습니다", code="invalid_request_id")
        filters.append(SeamlessGenerationLog.request_id == clean)
    if identifier is not None:
        clean = _safe_token(identifier)
        if clean is None:
            raise DomainError("식별자 형식이 올바르지 않습니다", code="invalid_identifier")
        try:
            identifier_uuid = uuid.UUID(clean)
        except ValueError:
            filters.append(SeamlessGenerationLog.request_id == clean)
        else:
            filters.append(
                or_(
                    SeamlessGenerationLog.id == identifier_uuid,
                    SeamlessGenerationLog.session_id == identifier_uuid,
                    SeamlessGenerationLog.user_id == identifier_uuid,
                    SeamlessGenerationLog.request_id == clean,
                )
            )
    return filters


def _error_projection(
    error_type: str | None,
    status: str,
    diagnostics: GenerationDiagnosticsOut,
) -> tuple[str | None, str | None]:
    if status != "error":
        return None, None
    safe_type = _safe_token(error_type) or "GenerationError"
    summaries = {
        "IntentInvalid": "입력 intent 검증에 실패했습니다",
        "AdapterNotConfigured": "생성 연동이 구성되지 않았습니다",
        "AdapterClientError": "외부 생성 연동에 실패했습니다",
        "HTTPException": "생성 요청이 거부되었습니다",
        "authoring_invalid": "디자인 계획 저작에 실패했습니다",
        "constraint_conflict": "선택한 생성 조건이 충돌했습니다",
        "intent_invalid": "디자인 intent 검증에 실패했습니다",
        "design_invalid": "디자인 합성에 실패했습니다",
        "semantic_mismatch": "요청한 주제와 맞는 구성을 만들지 못했습니다",
        "ScopeRejected": "구성 수정으로 표현할 수 없는 요청이라 거절했습니다",
    }
    provider = {
        "gemini": "Gemini",
        "openai_embedding": "OpenAI 임베딩",
        "vertex_embedding": "Vertex AI 임베딩",
    }.get(diagnostics.failure_provider or "")
    if provider and safe_type in {
        "AdapterClientError",
        "AdapterNotConfigured",
        "EmbeddingError",
    }:
        action = "구성되지 않았습니다" if safe_type == "AdapterNotConfigured" else "실패했습니다"
        return safe_type, f"{provider} 생성 연동에 {action}"
    return safe_type, summaries.get(safe_type, "생성 처리에 실패했습니다")


def _safe_diagnostics(value: Any) -> GenerationDiagnosticsOut:
    raw = value if isinstance(value, dict) else {}
    mode = raw.get("mode") if raw.get("mode") in GENERATION_MODES else None
    failure_code = _safe_token(raw.get("failure_code"))
    failure_stage = _safe_token(raw.get("failure_stage"))
    raw_axes = raw.get("patch_axes")
    patch_axes = [
        axis
        for item in (raw_axes[:8] if isinstance(raw_axes, list) else [])
        if (axis := _safe_token(item)) is not None
    ]

    def count(key: str) -> int | None:
        item = raw.get(key)
        return (
            item
            if isinstance(item, int) and not isinstance(item, bool) and 0 <= item <= 100
            else None
        )

    def milliseconds(key: str) -> float | None:
        item = raw.get(key)
        return (
            float(item)
            if isinstance(item, (int, float))
            and not isinstance(item, bool)
            and math.isfinite(item)
            and 0 <= item <= 900_000
            else None
        )

    def resolution(value: Any) -> MotifResolutionOut | None:
        if not isinstance(value, dict):
            return None
        similarity = value.get("similarity")
        safe_similarity = (
            float(similarity)
            if isinstance(similarity, (int, float))
            and not isinstance(similarity, bool)
            and math.isfinite(similarity)
            and -1 <= similarity <= 1
            else None
        )
        status_code = value.get("status_code")
        return MotifResolutionOut(
            layer_id=_safe_token(value.get("layer_id")),
            subject=_safe_metadata(value.get("subject"), limit=80),
            scope=_safe_token(value.get("scope")),
            outcome=_safe_token(value.get("outcome")),
            motif_id=_safe_token(value.get("motif_id")),
            similarity=safe_similarity,
            match_type=_safe_token(value.get("match_type")),
            provider=_safe_token(value.get("provider")),
            operation=_safe_token(value.get("operation")),
            reason_code=_safe_token(value.get("reason_code")),
            status_code=(
                status_code
                if isinstance(status_code, int)
                and not isinstance(status_code, bool)
                and 100 <= status_code <= 599
                else None
            ),
        )

    raw_resolutions = raw.get("motif_resolutions")
    resolutions = [
        item
        for value in (raw_resolutions[:16] if isinstance(raw_resolutions, list) else [])
        if (item := resolution(value)) is not None
    ]

    return GenerationDiagnosticsOut(
        mode=cast("GenerationMode | None", mode),
        model=_safe_token(raw.get("model")),
        prompt_revision=_safe_token(raw.get("prompt_revision")),
        patch_axes=patch_axes,
        authoring_attempts=count("authoring_attempts"),
        catalog_candidate_count=count("catalog_candidate_count"),
        resolved_count=count("resolved_count"),
        authoring_ms=milliseconds("authoring_ms"),
        compose_ms=milliseconds("compose_ms"),
        render_ms=milliseconds("render_ms"),
        failure_code=failure_code,
        failure_stage=failure_stage,
        failure_provider=_safe_token(raw.get("failure_provider")),
        failure_operation=_safe_token(raw.get("failure_operation")),
        failure_reason=_safe_token(raw.get("failure_reason")),
        failure_status_code=(
            raw["failure_status_code"]
            if isinstance(raw.get("failure_status_code"), int)
            and not isinstance(raw.get("failure_status_code"), bool)
            and 100 <= raw["failure_status_code"] <= 599
            else None
        ),
        motif_resolutions=resolutions,
    )


def _seamless_summary(row: SeamlessGenerationLog) -> SeamlessSummaryOut:
    diagnostics = _safe_diagnostics(row.diagnostics)
    error_type, error_summary = _error_projection(row.error_type, row.status, diagnostics)
    return SeamlessSummaryOut(
        id=row.id,
        request_id=_safe_token(row.request_id),
        input_type=_safe_token(row.input_type) or "unknown",
        status=cast("SeamlessStatus", row.status),
        warning_count=len(row.warnings or []),
        generate_ms=_milliseconds(row.generate_ms),
        render_ms=_milliseconds(row.render_ms),
        engine_version=_safe_metadata(row.engine_version),
        registry_version=_safe_token(row.registry_version),
        error_type=error_type,
        error_summary=error_summary,
        failure_code=diagnostics.failure_code,
        failure_stage=diagnostics.failure_stage,
        created_at=row.created_at,
    )


def _warning_groups(values: list[Any]) -> list[SeamlessWarningOut]:
    groups: dict[str, dict[str, Any]] = {}
    for value in values:
        warning = value if isinstance(value, str) else ""
        items: list[str] = []
        if warning.startswith("preview upload skipped"):
            code = "preview_unavailable"
        elif match := _MOTIF_DROP_WARNING.fullmatch(warning):
            code = "motif_layer_dropped"
            if subject := _safe_metadata(match.group(1), limit=80):
                items = [subject]
        elif match := _CMYK_WARNING.fullmatch(warning):
            code = "cmyk_gamut"
            items = [match.group(1).upper()]
        elif (
            warning.startswith("layer ")
            and ": spacing_mm " in warning
            and " snapped to " in warning
        ):
            code = "spacing_snap"
        elif (
            warning.startswith("stripe ") and " period_mm " in warning and " snapped to " in warning
        ):
            code = "stripe_period_snap"
        else:
            code = "generation_warning"
        group = groups.setdefault(code, {"count": 0, "items": []})
        group["count"] += 1
        for item in items:
            if item not in group["items"]:
                group["items"].append(item)
    return [
        SeamlessWarningOut(
            code=cast("WarningCode", code),
            count=group["count"],
            items=group["items"],
        )
        for code, group in groups.items()
    ]


def _safe_design(value: Any) -> SafeDesignOut | None:
    if not isinstance(value, dict):
        return None
    raw_svg = value.get("svg")
    svg = None
    svg_status: SvgStatus = "unavailable"
    if isinstance(raw_svg, str):
        try:
            svg = sanitize_svg(raw_svg)
            svg_status = "safe"
        except SanitizeError:
            svg_status = "unsafe"
    return SafeDesignOut(
        id=_safe_token(value.get("id")),
        layout_id=_safe_token(value.get("layout_id")),
        source_fidelity=_safe_token(value.get("source_fidelity")),
        colorway_id=_safe_token(value.get("colorway_id")),
        seed=value.get("seed") if isinstance(value.get("seed"), int) else None,
        svg=svg,
        svg_status=svg_status,
    )


async def _generation_outcome(
    session,
    row: SeamlessGenerationLog,
) -> GenerationOutcomeOut:
    if row.session_id is None:
        return GenerationOutcomeOut(user_id=row.user_id)
    requester = (
        await session.execute(
            select(User.id, User.name)
            .join(DesignSession, DesignSession.user_id == User.id)
            .where(DesignSession.id == row.session_id)
        )
    ).first()
    base = GenerationOutcomeOut(
        session_id=row.session_id,
        user_id=requester[0] if requester else row.user_id,
        user_name=requester[1] if requester else None,
    )
    # 턴 상관은 세션 스코프 안의 run_id 등가 매칭만 — 시간창 휴리스틱은 쓰지 않는다.
    generated_turn = await session.scalar(
        select(DesignSessionTurn)
        .where(
            DesignSessionTurn.session_id == row.session_id,
            DesignSessionTurn.role == "assistant",
            DesignSessionTurn.payload["type"].astext == "generate",
            DesignSessionTurn.payload["run_id"].astext == str(row.id),
        )
        .order_by(DesignSessionTurn.seq)
        .limit(1)
    )
    if generated_turn is None:
        return base

    next_request = await session.scalar(
        select(DesignSessionTurn)
        .where(
            DesignSessionTurn.session_id == generated_turn.session_id,
            DesignSessionTurn.seq > generated_turn.seq,
            DesignSessionTurn.payload["type"].astext == "generate_request",
        )
        .order_by(DesignSessionTurn.seq)
        .limit(1)
    )
    # 이력 썸네일로 이 스텝에 편집 포인터를 되돌린 기록 (없어도 정상 — 생성이 곧 활성화다)
    reactivated = bool(
        await session.scalar(
            select(func.count())
            .select_from(DesignSessionTurn)
            .where(
                DesignSessionTurn.session_id == generated_turn.session_id,
                DesignSessionTurn.seq > generated_turn.seq,
                DesignSessionTurn.payload["type"].astext == "activate",
                DesignSessionTurn.payload["run_id"].astext == str(row.id),
            )
        )
    )
    # run_id 등가 매칭으로 finalize job이 유일하게 식별되므로 finished_at 시간창은 두지 않는다.
    finalized = bool(
        await session.scalar(
            select(func.count())
            .select_from(GenerationJob)
            .where(
                GenerationJob.session_id == generated_turn.session_id,
                GenerationJob.kind == "finalize",
                GenerationJob.status == "succeeded",
                GenerationJob.params["run_id"].astext == str(row.id),
            )
        )
    )
    return base.model_copy(
        update={
            "reactivated": reactivated,
            "regenerated": next_request is not None,
            "finalized": finalized,
        }
    )


async def _generation_token_accounting(
    session,
    row: SeamlessGenerationLog,
) -> GenerationTokenAccountingOut:
    prefix = f"design_generate_{row.id.hex}_use_"
    entries = list(
        await session.scalars(
            select(DesignToken).where(
                DesignToken.work_id.startswith(prefix, autoescape=True),
                DesignToken.type.in_(("use", "refund")),
            )
        )
    )
    debited = sum(-entry.amount for entry in entries if entry.type == "use")
    refunded = sum(entry.amount for entry in entries if entry.type == "refund")
    return GenerationTokenAccountingOut(
        matched=bool(entries),
        debited=debited,
        refunded=refunded,
        net=refunded - debited,
    )


@router.get("/generation/seamless/stats", response_model=SeamlessStatsOut)
async def get_admin_seamless_stats(
    session: SessionDep,
    admin: AdminUser,
    status: SeamlessStatus | None = None,
    request_id: str | None = None,
    identifier: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
) -> SeamlessStatsOut:
    filters = _seamless_filters(
        status=status,
        request_id=request_id,
        identifier=identifier,
        start=start,
        end=end,
    )
    row = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(SeamlessGenerationLog.status == "success"),
                func.count().filter(SeamlessGenerationLog.status == "partial"),
                func.count().filter(SeamlessGenerationLog.status == "error"),
                func.avg(SeamlessGenerationLog.generate_ms),
                func.avg(SeamlessGenerationLog.render_ms),
            ).where(*filters)
        )
    ).one()
    return SeamlessStatsOut(
        total=int(row[0]),
        success=int(row[1]),
        partial=int(row[2]),
        error=int(row[3]),
        average_generate_ms=float(row[4]) if row[4] is not None else None,
        average_render_ms=float(row[5]) if row[5] is not None else None,
        as_of=datetime.now(UTC),
    )


@router.get("/generation/seamless", response_model=Page[SeamlessSummaryOut])
async def list_admin_seamless_logs(
    session: SessionDep,
    admin: AdminUser,
    status: SeamlessStatus | None = None,
    request_id: str | None = None,
    identifier: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[SeamlessSummaryOut]:
    filters = _seamless_filters(
        status=status,
        request_id=request_id,
        identifier=identifier,
        start=start,
        end=end,
    )
    total = int(
        await session.scalar(
            select(func.count()).select_from(SeamlessGenerationLog).where(*filters)
        )
        or 0
    )
    rows = await session.scalars(
        select(SeamlessGenerationLog)
        .where(*filters)
        .order_by(SeamlessGenerationLog.created_at.desc(), SeamlessGenerationLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return Page(
        items=[_seamless_summary(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/generation/seamless/{log_id}", response_model=SeamlessDetailOut)
async def get_admin_seamless_log(
    log_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> SeamlessDetailOut:
    row = await session.get(SeamlessGenerationLog, log_id)
    if row is None:
        raise NotFoundError("Seamless 생성 로그를 찾을 수 없습니다")
    summary = _seamless_summary(row)
    outcome = await _generation_outcome(session, row)
    token_accounting = await _generation_token_accounting(session, row)
    return SeamlessDetailOut(
        **summary.model_dump(),
        has_prompt=bool(row.prompt),
        prompt=row.prompt,
        intent=_safe_intent(row.intent),
        seed=row.seed,
        warning_groups=_warning_groups(row.warnings or []),
        diagnostics=_safe_diagnostics(row.diagnostics),
        outcome=outcome,
        token_accounting=token_accounting,
        design=_safe_design(row.design),
    )


def _motif_summary(row: Motif) -> MotifSummaryOut:
    symbol = None
    svg_status: SvgStatus = "unavailable"
    if row.symbol:
        try:
            symbol = sanitize_svg(row.symbol)
            svg_status = "safe"
        except SanitizeError:
            svg_status = "unsafe"
    return MotifSummaryOut(
        id=row.id,
        subject=_safe_metadata(row.subject),
        scope=_safe_token(row.scope),
        view=_safe_metadata(row.view),
        expression=_safe_metadata(row.expression),
        style=_safe_metadata(row.style),
        source=_safe_token(row.source) or "unknown",
        quality=row.quality,
        variant_group=_safe_token(row.variant_group),
        created_at=row.created_at,
        bbox=_number_list(row.bbox, size=4),
        symbol=symbol,
        svg_status=svg_status,
    )


@router.get("/motifs", response_model=Page[MotifSummaryOut])
async def list_admin_motifs(
    session: SessionDep,
    admin: AdminUser,
    scope: Literal["whole", "partial"] | None = None,
    source: Annotated[str | None, Query(max_length=50)] = None,
    q: Annotated[str | None, Query(min_length=2, max_length=100)] = None,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[MotifSummaryOut]:
    filters: list[ColumnElement[bool]] = []
    start_at, end_at = kst_day_bounds(start_date, end_date)
    if start_at is not None:
        filters.append(Motif.created_at >= start_at)
    if end_at is not None:
        filters.append(Motif.created_at < end_at)
    if scope is not None:
        filters.append(Motif.scope == scope)
    if source is not None:
        clean_source = _safe_token(source)
        if clean_source is None:
            raise DomainError("source 형식이 올바르지 않습니다", code="invalid_source")
        filters.append(Motif.source == clean_source)
    if q is not None:
        search = q.strip()
        if len(search) < 2:
            raise DomainError("검색어는 2자 이상이어야 합니다", code="invalid_search")
        filters.append(
            Motif.id.icontains(search, autoescape=True)
            | Motif.subject.icontains(search, autoescape=True)
            | Motif.source.icontains(search, autoescape=True)
        )
    total = int(await session.scalar(select(func.count()).select_from(Motif).where(*filters)) or 0)
    rows = await session.scalars(
        select(Motif)
        .where(*filters)
        .order_by(Motif.created_at.desc(), Motif.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return Page(
        items=[_motif_summary(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/motifs/{motif_id}", response_model=MotifDetailOut)
async def get_admin_motif(motif_id: str, session: SessionDep, admin: AdminUser) -> MotifDetailOut:
    row = await session.get(Motif, motif_id)
    if row is None:
        raise NotFoundError("Motif를 찾을 수 없습니다")
    summary = _motif_summary(row)
    return MotifDetailOut(
        **summary.model_dump(),
        description=_safe_metadata(row.description, limit=500),
        tags=[safe for tag in row.tags if (safe := _safe_metadata(tag, limit=80))],
        anchor=_number_list(row.anchor, size=2),
    )
