import logging
import time
from dataclasses import dataclass
from functools import wraps
from typing import Any, Never
from urllib.parse import urlparse

import httpx
from db.models.seamless import SeamlessGenerationLog
from fastapi import APIRouter, HTTPException, Request
from obs import request_id_var
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from worker.api.schemas import (
    DesignOut,
    GenerateRequest,
    GenerateResponse,
    GenerationWarning,
    MotifImportRequest,
    MotifImportResponse,
    PhotoMotifPreviewRequest,
    PhotoMotifPreviewResponse,
    ReferenceImageInput,
)
from worker.db import SessionDep
from worker.engine import (
    ComposedDesign,
    IntentInvalid,
    compose_design,
)
from worker.engine.constraints import ConstraintInvalid, apply_generation_constraints
from worker.engine.patch import set_motif_slot
from worker.integrations import content_key
from worker.motifs.fingerprint import registry_version_for
from worker.motifs.normalize import normalize_motif_svg
from worker.motifs.photo_svg import PhotoInputError, photo_to_svg
from worker.motifs.registry import iter_motif_ids
from worker.motifs.store import get_motifs
from worker.render.raster import RasterError, rasterize_svg
from worker.warnings import customer_warnings

router = APIRouter()
logger = logging.getLogger(__name__)

GENERATION_ERROR_MESSAGES = {
    "constraint_conflict": "the selected design constraints conflict",
    "intent_invalid": "the design input is invalid",
    "design_invalid": "the design could not be composed",
}


def _reject_generation(request: Request, code: str, stage: str) -> Never:
    diagnostics = request.state.generation_diagnostics
    diagnostics.update({"failure_code": code, "failure_stage": stage})
    raise HTTPException(
        status_code=422,
        detail={"code": code, "stage": stage, "message": GENERATION_ERROR_MESSAGES[code]},
    )


def _failure_contract(exc: Exception) -> tuple[str, str] | None:
    if not isinstance(exc, HTTPException) or not isinstance(exc.detail, dict):
        return None
    code = exc.detail.get("code")
    stage = exc.detail.get("stage")
    if code in GENERATION_ERROR_MESSAGES and isinstance(stage, str):
        return code, stage
    return None


def _safe_generation_error(exc: Exception) -> tuple[str, str]:
    if contract := _failure_contract(exc):
        return contract[0], f"generation rejected at {contract[1]} stage"
    source = exc.__cause__ if isinstance(exc.__cause__, Exception) else exc
    error_type = source.__class__.__name__
    if isinstance(source, IntentInvalid):
        return error_type, "intent validation failed"
    if isinstance(source, (AssertionError, ValueError)):
        return error_type, "generation input is invalid"
    if isinstance(exc, HTTPException):
        return "HTTPException", f"generation request rejected ({exc.status_code})"
    return error_type, "generation failed"


def _logged_generation(endpoint):  # noqa: ANN001 — FastAPI signature preserved by wraps
    @wraps(endpoint)
    async def wrapped(body: GenerateRequest, request: Request, session: SessionDep):
        started = time.perf_counter()
        request.state.generation_generate_ms = None
        request.state.generation_render_ms = 0.0
        request.state.generation_diagnostics = {
            "mode": "motif_slot" if body.motif_slot is not None else "variation",
        }
        try:
            return await endpoint(body, request, session)
        except Exception as exc:
            if contract := _failure_contract(exc):
                request.state.generation_diagnostics.update(
                    {"failure_code": contract[0], "failure_stage": contract[1]}
                )
            error_type, error_message = _safe_generation_error(exc)
            generate_ms = request.state.generation_generate_ms
            if generate_ms is None:
                generate_ms = round((time.perf_counter() - started) * 1000, 3)
            try:
                await session.rollback()
                log = SeamlessGenerationLog(
                    id=body.run_id,
                    request_id=request_id_var.get(),
                    session_id=body.session_id,
                    user_id=body.user_id,
                    input_type="intent",
                    colorway=body.colorway,
                    seed=body.seed,
                    warnings=[],
                    generate_ms=generate_ms,
                    render_ms=request.state.generation_render_ms,
                    status="error",
                    error_type=error_type,
                    error_message=error_message,
                    diagnostics=request.state.generation_diagnostics,
                )
                session.add(log)
                await session.commit()
            except Exception:
                logger.exception("generation error log persistence failed")
            raise

    return wrapped


def _generation_status(warnings: list[str]) -> str:
    partial = any(
        warning == "preview upload skipped" or " dropped" in warning for warning in warnings
    )
    return "partial" if partial else "success"


async def _render_design(
    design: ComposedDesign, tile_mm: float, request: Request, settings, warnings: list[str]
) -> DesignOut:
    """디자인 SVG를 프리뷰 래스터화·업로드해 DesignOut으로 — 실패는 경고로 격하."""

    render_started = time.perf_counter()
    png_key = None
    try:
        try:
            png, _media = await run_in_threadpool(
                rasterize_svg,
                design.svg,
                width_mm=tile_mm,
                dpi=settings.preview_dpi,
            )
        except (RasterError, OSError):
            warnings.append("preview upload skipped")
        else:
            # X-Request-ID is caller-controlled and may be reused. Include the PNG
            # digest so create-only uploads never alias different preview bytes.
            png_key = content_key(f"previews/{request_id_var.get()}/{design.id}", png, "png")
            try:
                await request.app.state.object_store.upload_bytes(png_key, png, "image/png")
            except Exception:
                # Preview persistence is best-effort. Keep this catch scoped to the
                # storage adapter so unexpected renderer bugs still fail the request.
                logger.warning("preview upload failed: %s", png_key, exc_info=True)
                png_key = None
                warnings.append("preview upload skipped")
    finally:
        request.state.generation_render_ms = round((time.perf_counter() - render_started) * 1000, 3)
    return DesignOut(
        id=design.id,
        layout_id=design.layout_id,
        source_fidelity=design.source_fidelity,
        colorway_id=design.colorway_id,
        seed=design.seed,
        svg=design.svg,
        png_object_key=png_key,
        panel_svg=design.panel_svg,
    )


def _reference_url_allowed(url: str, settings) -> bool:  # noqa: ANN001
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme == "https" and (
        hostname == "storage.googleapis.com"
        or hostname.endswith(".storage.googleapis.com")
        or hostname == "storage.googleapis.example"
    ):
        return True
    if settings.env in ("local", "test") and settings.gcs_emulator_host:
        emulator = urlparse(settings.gcs_emulator_host)
        return parsed.scheme == emulator.scheme and parsed.netloc == emulator.netloc
    return False


async def _fetch_reference_bytes(
    item: ReferenceImageInput, settings, client: httpx.AsyncClient
) -> bytes:
    if not _reference_url_allowed(item.url, settings):
        raise HTTPException(status_code=422, detail="reference image URL is not allowed")
    try:
        async with client.stream("GET", item.url) as response:
            response.raise_for_status()
            content_length = response.headers.get("content-length")
            if content_length is not None:
                try:
                    declared_length = int(content_length)
                except ValueError as exc:
                    raise HTTPException(
                        status_code=422, detail="reference image size mismatch"
                    ) from exc
                if declared_length != item.size_bytes:
                    raise HTTPException(status_code=422, detail="reference image size mismatch")
            chunks: list[bytes] = []
            received = 0
            async for chunk in response.aiter_bytes():
                received += len(chunk)
                if received > item.size_bytes or received > 10 * 1024 * 1024:
                    raise HTTPException(status_code=422, detail="reference image size mismatch")
                chunks.append(chunk)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="reference image fetch failed") from exc
    data = b"".join(chunks)
    if len(data) != item.size_bytes or len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="reference image size mismatch")
    return data


async def _load_single_image(item: ReferenceImageInput, settings) -> bytes:  # noqa: ANN001
    # 외부 URL fetch 전용 — 리다이렉트 금지(SSRF 완화)·60s 상한.
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=False) as client:
        return await _fetch_reference_bytes(item, settings, client)


@dataclass(frozen=True)
class _GenerateOutcome:
    design: ComposedDesign
    resolved_intent: dict[str, Any]
    tile_mm: float
    intent_log: dict[str, Any]


async def _generate_from_intent(
    body: GenerateRequest,
    request: Request,
    session: AsyncSession,
    *,
    warnings: list[str],
) -> _GenerateOutcome:
    try:
        raw_intent = body.intent
        if body.motif_slot is not None:
            raw_intent = set_motif_slot(
                raw_intent,
                slot=body.motif_slot.slot,
                motif_id=body.motif_slot.motif_id,
            )
        constrained_intent = apply_generation_constraints(raw_intent, warnings=warnings)
    except ConstraintInvalid:
        _reject_generation(request, "constraint_conflict", "constraints")
    catalog = await get_motifs(session, iter_motif_ids(constrained_intent))
    compose_started = time.perf_counter()
    try:
        design = compose_design(
            constrained_intent,
            seed=body.seed,
            colorway=body.colorway,
            motifs=catalog or None,  # DB에 없으면 전역 registry 폴백(테스트/시드 경로)
        )
    except IntentInvalid:
        _reject_generation(request, "intent_invalid", "intent")
    except (AssertionError, ValueError):
        # 검증 통과 후의 합성 실패.
        _reject_generation(request, "design_invalid", "design")
    finally:
        request.state.generation_diagnostics["compose_ms"] = round(
            (time.perf_counter() - compose_started) * 1000, 3
        )
    return _GenerateOutcome(
        design=design,
        resolved_intent=constrained_intent,
        tile_mm=float(constrained_intent["canvas"]["tile_mm"]),
        intent_log={
            "design": constrained_intent,
            "resolved_plan": None,
            **({"motif_slot": body.motif_slot.model_dump()} if body.motif_slot is not None else {}),
        },
    )


@router.post("/generate", response_model=GenerateResponse)
@_logged_generation
async def generate(
    body: GenerateRequest, request: Request, session: SessionDep
) -> GenerateResponse:
    started = time.perf_counter()
    settings = request.app.state.settings
    registry_version = await registry_version_for(session)
    warnings: list[str] = []
    outcome = await _generate_from_intent(body, request, session, warnings=warnings)

    warnings.extend(outcome.design.warnings)
    warnings = list(dict.fromkeys(warnings))
    generate_ms = round((time.perf_counter() - started) * 1000, 3)
    request.state.generation_generate_ms = generate_ms
    out = await _render_design(outcome.design, outcome.tile_mm, request, settings, warnings)
    request.state.generation_diagnostics["render_ms"] = request.state.generation_render_ms

    generation_log_id = body.run_id
    log = SeamlessGenerationLog(
        id=generation_log_id,
        request_id=request_id_var.get(),
        session_id=body.session_id,
        user_id=body.user_id,
        input_type="intent",
        colorway=body.colorway,
        seed=body.seed,
        engine_version=settings.engine_version,
        registry_version=registry_version,
        intent=outcome.intent_log,
        design={**out.model_dump(), "intent": outcome.design.intent.model_dump(mode="json")},
        warnings=warnings,
        generate_ms=generate_ms,
        render_ms=request.state.generation_render_ms,
        status=_generation_status(warnings),
        diagnostics=request.state.generation_diagnostics,
    )
    session.add(log)
    await session.commit()
    return GenerateResponse(
        generation_log_id=generation_log_id,
        request_id=request_id_var.get(),
        registry_version=registry_version,
        engine_version=settings.engine_version,
        intent=outcome.resolved_intent,
        design=out,
        # 진단 문자열은 로그에만 남기고 응답에는 고객 문구가 있는 경고만 내린다.
        warnings=[GenerationWarning(**item) for item in customer_warnings(warnings)],
    )


async def _normalize_preview_svg(svg: str, request: Request, *, id_prefix: str) -> str:
    settings = request.app.state.settings
    normalized = await run_in_threadpool(
        normalize_motif_svg,
        svg,
        id_prefix=id_prefix,
        max_aspect_ratio=settings.motif_max_aspect_ratio,
        edge_seam_tol=settings.motif_edge_seam_tol,
        render_check=settings.motif_render_check,
    )
    return normalized.preview_svg


@router.post("/motifs/photo-preview", response_model=PhotoMotifPreviewResponse)
async def photo_motif_preview(
    body: PhotoMotifPreviewRequest, request: Request
) -> PhotoMotifPreviewResponse:
    data = await _load_single_image(body.image, request.app.state.settings)
    try:
        result = await run_in_threadpool(photo_to_svg, data, body.image.content_type)
        svg = await _normalize_preview_svg(result.svg, request, id_prefix="photo-preview")
    except PhotoInputError as exc:
        # 사용자가 다른 사진으로 고칠 수 있는 거절 — code를 실어야 api가 고객 문구를 고른다.
        raise HTTPException(
            status_code=422, detail={"code": exc.code, "message": str(exc)}
        ) from exc
    except (ValueError, TypeError, RecursionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return PhotoMotifPreviewResponse(
        svg=svg,
        processed_preview_base64=result.processed_preview_base64,
        background_confidence=result.background_confidence,
        warnings=result.warnings,
    )


@router.post("/motifs/import", response_model=MotifImportResponse)
async def motif_import(body: MotifImportRequest, request: Request) -> MotifImportResponse:
    settings = request.app.state.settings
    try:
        normalized = await run_in_threadpool(
            normalize_motif_svg,
            body.svg,
            id_prefix="upload",
            max_aspect_ratio=settings.motif_max_aspect_ratio,
            edge_seam_tol=settings.motif_edge_seam_tol,
            render_check=settings.motif_render_check,
        )
    except (ValueError, TypeError, RecursionError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid motif SVG: {exc}") from exc
    # Pure normalization boundary. The API writes Motif + UserMotif in one owner-scoped DB
    # transaction, so a quota/link failure can never leave an ownerless private motif here.
    return MotifImportResponse(
        motif_id=normalized.id,
        symbol=normalized.symbol,
        bbox=normalized.bbox_mm,
        anchor=normalized.anchor,
        preview_svg=normalized.preview_svg,
    )
