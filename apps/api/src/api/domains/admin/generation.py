"""관리자 디자인 렌더 로그·무늬(Motif) projection.

목록은 raw SVG/사용자 식별자/object key를 절대 반환하지 않는다. 상세 조회는
allowlist로 투영한 intent와 worker 공유 sanitizer를 다시 통과한 SVG만 노출한다.
"""

import math
import re
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal, cast, get_args

from db.models.auth import User
from db.models.design import DesignSession
from db.models.seamless import Motif, SeamlessGenerationLog
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, func, or_, select
from svg_safety import SanitizeError, sanitize_svg

from api.db import SessionDep
from api.deps import AdminOnly, AdminUser
from api.domains.admin.helpers import kst_day_bounds
from api.domains.admin.schemas import Page
from api.errors import DomainError, NotFoundError
from api.schemas import StrictModel

router = APIRouter(prefix="/admin", tags=["admin-generation"])

SeamlessStatus = Literal["success", "partial", "error"]
SvgStatus = Literal["safe", "unavailable", "unsafe"]
# 워커의 `_logged_generation`이 intent 경로에서 기록하는 2종 (worker/api/routes.py)
GenerationMode = Literal["variation", "motif_slot"]
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
        "avoid_layer",
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
        # 격자 위상 — 두 모티프 슬롯이 반 칸 엇갈렸는지 화면에서 판단하는 유일한 값
        "offset_x_mm",
        "offset_y_mm",
        "scatter",
        "mode",
        "min_dist_mm",
        "count",
        "sateen_n",
        "sateen_step",
        # 산개 난수열 분리 키 — 없으면 admin이 읽은 intent로 같은 배치를 재현할 수 없다
        "seed_salt",
        "point_set",
        "points",
    }
)
_INTENT_DYNAMIC_MAP_KEYS = frozenset({"mapping"})
_INTENT_OMIT = object()
_MAX_INTENT_SEQUENCE = 10_000
_MAX_INTENT_DEPTH = 12
# worker의 DesignPatchV1 상한과 같은 값 — 초과분은 잘라낸다.


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


class GenerationOutcomeOut(BaseModel):
    session_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    user_name: str | None = None


class GenerationDiagnosticsOut(BaseModel):
    mode: GenerationMode | None = None
    compose_ms: float | None = None
    render_ms: float | None = None
    failure_code: str | None = None
    failure_stage: str | None = None


class SeamlessDetailOut(SeamlessSummaryOut):
    intent: dict[str, Any] | None
    seed: int | None
    warning_groups: list[SeamlessWarningOut]
    diagnostics: GenerationDiagnosticsOut
    outcome: GenerationOutcomeOut
    design: SafeDesignOut | None


class MotifSummaryOut(BaseModel):
    id: str
    subject: str | None
    scope: str | None
    style: str | None
    source: str
    created_at: datetime
    bbox: list[float]
    symbol: str | None
    svg_status: SvgStatus


class MotifDetailOut(MotifSummaryOut):
    anchor: list[float]
    # 처음 올린 고객(로고 업로드) — 모티프 행에서 업로더를 볼 수 있는 유일한 경로다.
    ingested_user_id: uuid.UUID | None
    ingested_session_id: uuid.UUID | None


class MotifUpdateRequest(StrictModel):
    subject: str | None = None
    style: Literal["flat", "outline"] | None = None


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


def _editable_metadata(value: str | None, *, limit: int) -> str | None:
    if value is None:
        return None
    safe = _safe_metadata(value, limit=limit)
    if safe is None:
        raise DomainError(
            "Motif 메타데이터 형식이 올바르지 않습니다",
            code="invalid_motif_metadata",
        )
    return safe


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


def _error_projection(error_type: str | None, status: str) -> tuple[str | None, str | None]:
    if status != "error":
        return None, None
    safe_type = _safe_token(error_type) or "GenerationError"
    summaries = {
        "IntentInvalid": "입력 intent 검증에 실패했습니다",
        "HTTPException": "생성 요청이 거부되었습니다",
        "constraint_conflict": "선택한 생성 조건이 충돌했습니다",
        "intent_invalid": "디자인 intent 검증에 실패했습니다",
        "design_invalid": "디자인 합성에 실패했습니다",
    }
    return safe_type, summaries.get(safe_type, "생성 처리에 실패했습니다")


def _safe_diagnostics(value: Any) -> GenerationDiagnosticsOut:
    raw = value if isinstance(value, dict) else {}
    mode = raw.get("mode") if raw.get("mode") in GENERATION_MODES else None

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

    return GenerationDiagnosticsOut(
        mode=cast("GenerationMode | None", mode),
        compose_ms=milliseconds("compose_ms"),
        render_ms=milliseconds("render_ms"),
        failure_code=_safe_token(raw.get("failure_code")),
        failure_stage=_safe_token(raw.get("failure_stage")),
    )


def _seamless_summary(row: SeamlessGenerationLog) -> SeamlessSummaryOut:
    diagnostics = _safe_diagnostics(row.diagnostics)
    error_type, error_summary = _error_projection(row.error_type, row.status)
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
    return GenerationOutcomeOut(
        session_id=row.session_id,
        user_id=requester[0] if requester else row.user_id,
        user_name=requester[1] if requester else None,
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
        raise NotFoundError("디자인 렌더 로그를 찾을 수 없습니다")
    summary = _seamless_summary(row)
    outcome = await _generation_outcome(session, row)
    return SeamlessDetailOut(
        **summary.model_dump(),
        intent=_safe_intent(row.intent),
        seed=row.seed,
        warning_groups=_warning_groups(row.warnings or []),
        diagnostics=_safe_diagnostics(row.diagnostics),
        outcome=outcome,
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
        style=_safe_metadata(row.style),
        source=_safe_token(row.source) or "unknown",
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
    return _motif_detail(row)


@router.patch("/motifs/{motif_id}", response_model=MotifDetailOut)
async def update_admin_motif(
    motif_id: str,
    body: MotifUpdateRequest,
    session: SessionDep,
    admin: AdminOnly,
) -> MotifDetailOut:
    if not body.model_fields_set:
        raise DomainError(
            "변경할 Motif 메타데이터를 입력해 주세요",
            code="empty_motif_update",
        )
    row = await session.scalar(select(Motif).where(Motif.id == motif_id).with_for_update())
    if row is None:
        raise NotFoundError("Motif를 찾을 수 없습니다")

    values: dict[str, Any] = {}
    if "subject" in body.model_fields_set:
        values["subject"] = _editable_metadata(body.subject, limit=160)
    if "style" in body.model_fields_set:
        values["style"] = body.style

    changed = any(getattr(row, field) != value for field, value in values.items())
    if changed:
        for field, value in values.items():
            setattr(row, field, value)
        await session.commit()
    return _motif_detail(row)


def _motif_detail(row: Motif) -> MotifDetailOut:
    summary = _motif_summary(row)
    return MotifDetailOut(
        **summary.model_dump(),
        anchor=_number_list(row.anchor, size=2),
        ingested_user_id=row.ingested_user_id,
        ingested_session_id=row.ingested_session_id,
    )
