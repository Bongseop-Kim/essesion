"""관리자 생성 운영·Motif 읽기 전용 projection.

목록은 raw prompt/SVG/사용자 식별자/object key를 절대 반환하지 않는다. 상세 조회는
저장된 prompt 원문, allowlist로 투영한 intent와 worker 공유 sanitizer를 다시 통과한
SVG만 노출한다.
"""

import math
import re
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any, Literal, cast

from db.models.design import DesignSessionTurn, GenerationJob
from db.models.images import Image
from db.models.seamless import Motif, SeamlessGenerationLog
from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, func, select
from svg_safety import SanitizeError, sanitize_svg

from api.db import SessionDep
from api.deps import AdminUser, SettingsDep
from api.domains.admin.helpers import kst_day_bounds
from api.domains.admin.quote_schemas import SignedReadUrlOut
from api.domains.admin.schemas import Page
from api.errors import DomainError, NotFoundError
from api.integrations.gcs import public_asset_url

router = APIRouter(prefix="/admin", tags=["admin-generation"])

JobKind = Literal["finalize", "export"]
JobStatus = Literal["queued", "processing", "succeeded", "failed", "canceled"]
SeamlessStatus = Literal["success", "partial", "error"]
SvgStatus = Literal["safe", "unavailable", "unsafe"]
WarningCode = Literal[
    "candidate_variants_dropped",
    "cmyk_gamut",
    "design_dropped",
    "diversity_shortfall",
    "generation_warning",
    "motif_layer_dropped",
    "partial_candidates",
    "preview_unavailable",
]
DEFAULT_LIMIT = 20
MAX_LIMIT = 100
SEAMLESS_REFERENCE_IMAGE_ENTITY_TYPE = "seamless_generation"
SEAMLESS_REFERENCE_IMAGE_PREFIX = "uploads/seamless_generation/"

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
        "colors",
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
_INTENT_DYNAMIC_MAP_KEYS = frozenset({"mapping", "colors"})
_INTENT_OMIT = object()
_MAX_INTENT_DESIGNS = 8
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
    candidate_count_requested: int | None
    candidate_count_returned: int | None
    distinct_layouts: int | None
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


class SafeCandidateOut(BaseModel):
    id: str | None
    design_index: int | None
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
    selected_candidate_id: str | None = None
    regenerated: bool = False
    finalized: bool = False


class GenerationDiagnosticsOut(BaseModel):
    mode: Literal["prompt", "variation"] | None = None
    model: str | None = None
    prompt_revision: str | None = None
    reference_count: int | None = None
    fixed_palette: bool | None = None
    pattern_controls: bool | None = None
    authoring_attempts: int | None = None
    plan_count: int | None = None
    validated_count: int | None = None
    catalog_candidate_count: int | None = None
    resolved_count: int | None = None
    candidate_count: int | None = None
    authoring_ms: float | None = None
    motif_resolution_ms: float | None = None
    candidate_ms: float | None = None
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
    intents: list[dict[str, Any]]
    has_reference_image: bool
    reference_image_bytes: int | None
    reference_image_id: uuid.UUID | None
    reference_image_available: bool
    seed: int | None
    available_strategies: int | None
    warning_groups: list[SeamlessWarningOut]
    diagnostics: GenerationDiagnosticsOut
    outcome: GenerationOutcomeOut
    candidates: list[SafeCandidateOut]


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
    color_slot_count: int
    created_at: datetime
    bbox: list[float]
    symbol: str | None
    svg_status: SvgStatus


class MotifDetailOut(MotifSummaryOut):
    description: str | None
    tags: list[str]
    anchor: list[float]
    color_slots: list[str]


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


def _safe_intents(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, dict) or not isinstance(value.get("designs"), list):
        return []
    intents: list[dict[str, Any]] = []
    for design in value["designs"][:_MAX_INTENT_DESIGNS]:
        projected = _safe_intent_value(design)
        if isinstance(projected, dict) and projected:
            intents.append(projected)
    return intents


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
        "reference_invalid": "참고 이미지를 처리하지 못했습니다",
        "intent_invalid": "디자인 intent 검증에 실패했습니다",
        "candidate_invalid": "후보 구성에 실패했습니다",
    }
    provider = {
        "gemini": "Gemini",
        "openai_embedding": "OpenAI 임베딩",
        "vertex_embedding": "Vertex AI 임베딩",
        "recraft": "Recraft",
    }.get(diagnostics.failure_provider or "")
    if provider and safe_type in {
        "AdapterClientError",
        "AdapterNotConfigured",
        "EmbeddingError",
        "RecraftError",
    }:
        action = "구성되지 않았습니다" if safe_type == "AdapterNotConfigured" else "실패했습니다"
        return safe_type, f"{provider} 생성 연동에 {action}"
    return safe_type, summaries.get(safe_type, "생성 처리에 실패했습니다")


def _safe_diagnostics(value: Any) -> GenerationDiagnosticsOut:
    raw = value if isinstance(value, dict) else {}
    mode = raw.get("mode") if raw.get("mode") in {"prompt", "variation"} else None
    failure_code = _safe_token(raw.get("failure_code"))
    failure_stage = _safe_token(raw.get("failure_stage"))

    def count(key: str) -> int | None:
        item = raw.get(key)
        return (
            item
            if isinstance(item, int) and not isinstance(item, bool) and 0 <= item <= 100
            else None
        )

    def flag(key: str) -> bool | None:
        item = raw.get(key)
        return item if isinstance(item, bool) else None

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
        mode=cast("Literal['prompt', 'variation'] | None", mode),
        model=_safe_token(raw.get("model")),
        prompt_revision=_safe_token(raw.get("prompt_revision")),
        reference_count=count("reference_count"),
        fixed_palette=flag("fixed_palette"),
        pattern_controls=flag("pattern_controls"),
        authoring_attempts=count("authoring_attempts"),
        plan_count=count("plan_count"),
        validated_count=count("validated_count"),
        catalog_candidate_count=count("catalog_candidate_count"),
        resolved_count=count("resolved_count"),
        candidate_count=count("candidate_count"),
        authoring_ms=milliseconds("authoring_ms"),
        motif_resolution_ms=milliseconds("motif_resolution_ms"),
        candidate_ms=milliseconds("candidate_ms"),
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
        candidate_count_requested=row.candidate_count_requested,
        candidate_count_returned=row.candidate_count_returned,
        distinct_layouts=row.distinct_layouts,
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
        elif warning.startswith("partial:"):
            code = "partial_candidates"
        elif warning.startswith("diversity shortfall:"):
            code = "diversity_shortfall"
        elif match := _MOTIF_DROP_WARNING.fullmatch(warning):
            code = "motif_layer_dropped"
            if subject := _safe_metadata(match.group(1), limit=80):
                items = [subject]
        elif match := _CMYK_WARNING.fullmatch(warning):
            code = "cmyk_gamut"
            items = [match.group(1).upper()]
        elif re.fullmatch(r"\d+ candidate variant\(s\) failed to render and were dropped", warning):
            code = "candidate_variants_dropped"
        elif warning.startswith("design ") and " dropped:" in warning:
            code = "design_dropped"
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


def _safe_candidate(value: Any) -> SafeCandidateOut | None:
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
    return SafeCandidateOut(
        id=_safe_token(value.get("id")),
        design_index=(
            value.get("design_index") if isinstance(value.get("design_index"), int) else None
        ),
        layout_id=_safe_token(value.get("layout_id")),
        source_fidelity=_safe_token(value.get("source_fidelity")),
        colorway_id=_safe_token(value.get("colorway_id")),
        seed=value.get("seed") if isinstance(value.get("seed"), int) else None,
        svg=svg,
        svg_status=svg_status,
    )


async def _seamless_reference_image(
    session,
    row: SeamlessGenerationLog,  # noqa: ANN001 — SessionDep 전달
) -> Image | None:
    if row.reference_image_id is None:
        return None
    return await session.scalar(
        select(Image).where(
            Image.id == row.reference_image_id,
            Image.entity_type == SEAMLESS_REFERENCE_IMAGE_ENTITY_TYPE,
            Image.entity_id == str(row.id),
            Image.upload_completed_at.is_not(None),
            Image.deleted_at.is_(None),
        )
    )


def _reference_image_available(image: Image | None) -> bool:
    return bool(
        image is not None
        and image.object_key.startswith(SEAMLESS_REFERENCE_IMAGE_PREFIX)
        and (image.expires_at is None or image.expires_at > datetime.now(UTC))
    )


async def _generation_outcome(
    session,
    row: SeamlessGenerationLog,
    candidate_ids: list[str],
) -> GenerationOutcomeOut:
    exact_link = DesignSessionTurn.payload["response"]["generation_log_id"].astext == str(row.id)
    turn_query = (
        select(DesignSessionTurn)
        .where(
            DesignSessionTurn.role == "assistant",
            DesignSessionTurn.payload["type"].astext == "generate",
        )
        .order_by(DesignSessionTurn.created_at, DesignSessionTurn.seq)
        .limit(1)
    )
    generated_turn = await session.scalar(turn_query.where(exact_link))
    if generated_turn is None and (request_id := _safe_token(row.request_id)):
        generated_turn = await session.scalar(
            turn_query.where(
                DesignSessionTurn.payload["response"]["request_id"].astext == request_id,
                DesignSessionTurn.created_at >= row.created_at - timedelta(minutes=15),
                DesignSessionTurn.created_at <= row.created_at + timedelta(minutes=15),
            )
        )
    if generated_turn is None:
        return GenerationOutcomeOut()

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
    selection_filters = [
        DesignSessionTurn.session_id == generated_turn.session_id,
        DesignSessionTurn.seq > generated_turn.seq,
        DesignSessionTurn.payload["type"].astext == "select",
    ]
    if next_request is not None:
        selection_filters.append(DesignSessionTurn.seq < next_request.seq)
    selected_candidate_id = None
    if candidate_ids:
        selected_candidate_id = await session.scalar(
            select(DesignSessionTurn.payload["candidate_id"].astext)
            .where(
                *selection_filters,
                DesignSessionTurn.payload["candidate_id"].astext.in_(candidate_ids),
            )
            .order_by(DesignSessionTurn.seq.desc())
            .limit(1)
        )

    finalized_filters = [
        GenerationJob.session_id == generated_turn.session_id,
        GenerationJob.kind == "finalize",
        GenerationJob.status == "succeeded",
        GenerationJob.created_at >= generated_turn.created_at,
    ]
    if next_request is not None:
        finalized_filters.append(GenerationJob.created_at < next_request.created_at)
    finalized = bool(
        await session.scalar(
            select(func.count()).select_from(GenerationJob).where(*finalized_filters)
        )
    )
    return GenerationOutcomeOut(
        session_id=generated_turn.session_id,
        selected_candidate_id=_safe_token(selected_candidate_id),
        regenerated=next_request is not None,
        finalized=finalized,
    )


@router.get("/generation/seamless/stats", response_model=SeamlessStatsOut)
async def get_admin_seamless_stats(
    session: SessionDep,
    admin: AdminUser,
    status: SeamlessStatus | None = None,
    request_id: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
) -> SeamlessStatsOut:
    filters = _seamless_filters(status=status, request_id=request_id, start=start, end=end)
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
    start: datetime | None = None,
    end: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[SeamlessSummaryOut]:
    filters = _seamless_filters(status=status, request_id=request_id, start=start, end=end)
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
    candidates = [
        candidate for item in (row.candidates or []) if (candidate := _safe_candidate(item))
    ]
    reference_image = await _seamless_reference_image(session, row)
    outcome = await _generation_outcome(
        session,
        row,
        [candidate.id for candidate in candidates if candidate.id is not None],
    )
    return SeamlessDetailOut(
        **summary.model_dump(),
        has_prompt=bool(row.prompt),
        prompt=row.prompt,
        intents=_safe_intents(row.intent),
        has_reference_image=row.has_reference_image,
        reference_image_bytes=row.reference_image_bytes,
        reference_image_id=row.reference_image_id,
        reference_image_available=_reference_image_available(reference_image),
        seed=row.seed,
        available_strategies=row.available_strategies,
        warning_groups=_warning_groups(row.warnings or []),
        diagnostics=_safe_diagnostics(row.diagnostics),
        outcome=outcome,
        candidates=candidates,
    )


@router.post(
    "/generation/seamless/{log_id}/reference-image/{image_id}/read-url",
    response_model=SignedReadUrlOut,
)
async def create_admin_seamless_reference_image_read_url(
    log_id: uuid.UUID,
    image_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> SignedReadUrlOut:
    row = await session.get(SeamlessGenerationLog, log_id)
    if row is None:
        raise NotFoundError("Seamless 생성 로그를 찾을 수 없습니다")
    if row.reference_image_id != image_id:
        raise NotFoundError("Seamless 참고 이미지를 찾을 수 없습니다")

    image = await _seamless_reference_image(session, row)
    if image is None or not image.object_key.startswith(SEAMLESS_REFERENCE_IMAGE_PREFIX):
        raise NotFoundError("Seamless 참고 이미지를 찾을 수 없습니다")
    if image.expires_at is not None and image.expires_at <= datetime.now(UTC):
        raise DomainError("이미지가 만료되었습니다", code="image_expired")
    return SignedReadUrlOut(read_url=await request.app.state.gcs.signed_read_url(image.object_key))


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
        color_slot_count=len(row.color_slots or []),
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
        color_slots=[safe for slot in row.color_slots if (safe := _safe_token(slot))],
    )
