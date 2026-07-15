import asyncio
import logging
import time
import uuid
from datetime import UTC, datetime, timedelta
from functools import wraps
from typing import Any, Literal

from db.models.design import (
    FINALIZE_DISPATCH_FAILED_MESSAGE,
    FINALIZE_TEMPORARY_FAILURE_CODE,
    FINALIZE_TEMPORARY_FAILURE_MARKER,
    FINALIZE_TEMPORARY_FAILURE_MESSAGE,
    GenerationJob,
)
from db.models.seamless import SeamlessGenerationLog
from fastapi import APIRouter, HTTPException, Request, Response
from obs import request_id_var
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from worker.adapters import AdapterClientError, AdapterNotConfigured
from worker.adapters.embedding import request_scoped
from worker.adapters.gemini import normalize_stripes
from worker.db import SessionDep
from worker.engine import (
    IntentInvalid,
    generate_candidate_set,
    generate_candidates,
    validate_intent,
)
from worker.integrations import content_key
from worker.motifs.fingerprint import registry_version_for
from worker.motifs.registry import iter_motif_ids
from worker.motifs.resolver import present_candidates, resolve_motifs, resolve_spec
from worker.motifs.store import get_motifs
from worker.render.fabric import FabricError, render_fabric
from worker.render.raster import RasterError, RasterLimitError, rasterize_svg
from worker.render.sanitize import scrub_svg

generate_router = APIRouter()
finalize_router = APIRouter()
logger = logging.getLogger(__name__)

FINALIZE_INVALID_INPUT_CODE = "FINALIZE_INVALID_INPUT"
FINALIZE_INVALID_INPUT_MESSAGE = "finalize input is invalid"


class GenerateRequest(BaseModel):
    prompt: str | None = None
    intent: dict[str, Any] | None = None
    colorway: str | None = None
    seed: int | None = None
    candidate_count: int = Field(default=1, ge=1, le=8)


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
    request_id: str
    registry_version: str
    engine_version: str
    intents: list[dict[str, Any]]
    candidates: list[CandidateOut]
    warnings: list[str] = []


class ExportRequest(BaseModel):
    svg: str = Field(max_length=2_000_000)
    format: Literal["png", "tiff"] = "png"
    dpi: int = Field(default=300, ge=1)
    width_mm: float = Field(gt=0)
    height_mm: float | None = Field(default=None, gt=0)


class FinalizeTaskRequest(BaseModel):
    job_id: uuid.UUID


class MotifSpec(BaseModel):
    subject: str
    scope: str
    view: str | None = None
    expression: str | None = None
    style: str | None = None
    description: str | None = None


class CandidatesRequest(BaseModel):
    spec: MotifSpec
    top_k: int = Field(default=5, ge=1, le=10)


class MotifGenerateRequest(BaseModel):
    spec: MotifSpec
    seed: int | None = None


def _safe_generation_error(exc: Exception) -> tuple[str, str]:
    source = exc.__cause__ if isinstance(exc.__cause__, Exception) else exc
    error_type = source.__class__.__name__
    if isinstance(source, IntentInvalid):
        return error_type, "intent validation failed"
    if isinstance(source, AdapterNotConfigured):
        return error_type, "generation adapter is not configured"
    if isinstance(source, AdapterClientError):
        return error_type, "generation adapter request failed"
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
        try:
            return await endpoint(body, request, session)
        except Exception as exc:
            error_type, error_message = _safe_generation_error(exc)
            generate_ms = request.state.generation_generate_ms
            if generate_ms is None:
                generate_ms = round((time.perf_counter() - started) * 1000, 3)
            try:
                await session.rollback()
                session.add(
                    SeamlessGenerationLog(
                        request_id=request_id_var.get(),
                        input_type="intent" if body.intent is not None else "prompt",
                        prompt=body.prompt,
                        colorway=body.colorway,
                        seed=body.seed,
                        candidate_count_requested=body.candidate_count,
                        warnings=[],
                        generate_ms=generate_ms,
                        render_ms=request.state.generation_render_ms,
                        status="error",
                        error_type=error_type,
                        error_message=error_message,
                    )
                )
                await session.commit()
            except Exception:
                logger.exception("generation error log persistence failed")
            raise

    return wrapped


async def _render_candidates(
    candidate_set, tile_mm: float, request: Request, settings, warnings: list[str]
) -> list[CandidateOut]:
    """후보 SVG를 프리뷰 래스터화·업로드하고 CandidateOut 목록으로 — 실패는 경고로 격하.

    후보별 렌더+업로드는 병렬(gather), 응답의 후보·경고 순서는 입력 순서 그대로.
    """

    semaphore = asyncio.Semaphore(settings.preview_render_concurrency)

    async def _one(ranked) -> tuple[CandidateOut, str | None]:
        png_key = None
        warning = None
        async with semaphore:
            try:
                png, _media = await run_in_threadpool(
                    rasterize_svg,
                    ranked.candidate.svg,
                    width_mm=tile_mm,
                    dpi=settings.preview_dpi,
                )
            except (RasterError, OSError):
                warning = "preview upload skipped"
            else:
                # X-Request-ID is caller-controlled and may be reused. Include the PNG
                # digest so create-only uploads never alias different preview bytes.
                png_key = content_key(f"previews/{request_id_var.get()}/{ranked.id}", png, "png")
                try:
                    await request.app.state.object_store.upload_bytes(png_key, png, "image/png")
                except Exception:
                    # Preview persistence is best-effort. Keep this catch scoped to the
                    # storage adapter so unexpected renderer bugs still fail the request.
                    logger.warning("preview upload failed: %s", png_key, exc_info=True)
                    png_key = None
                    warning = "preview upload skipped"
        out = CandidateOut(
            id=ranked.id,
            design_index=ranked.design_index,
            layout_id=ranked.candidate.layout_id or "",
            source_fidelity=ranked.source_fidelity,
            colorway_id=ranked.colorway_id,
            seed=ranked.seed,
            svg=ranked.candidate.svg,
            png_object_key=png_key,
        )
        return out, warning

    render_started = time.perf_counter()
    try:
        rendered = await asyncio.gather(*(_one(r) for r in candidate_set.candidates))
        outs: list[CandidateOut] = []
        for out, warning in rendered:
            if warning is not None:
                warnings.append(warning)
            outs.append(out)
        return outs
    finally:
        request.state.generation_render_ms = round((time.perf_counter() - render_started) * 1000, 3)


@generate_router.post("/generate", response_model=GenerateResponse)
@_logged_generation
async def generate(
    body: GenerateRequest, request: Request, session: SessionDep
) -> GenerateResponse:
    started = time.perf_counter()
    settings = request.app.state.settings
    adapters = request.app.state.adapters
    registry_version = await registry_version_for(session)
    warnings: list[str] = []

    if body.intent is not None:
        input_type = "intent"
        resolved_intents = [body.intent]
        catalog = await get_motifs(session, iter_motif_ids(body.intent))
        try:
            candidate_set = generate_candidates(
                body.intent,
                candidate_count=body.candidate_count,
                seed=body.seed,
                colorway=body.colorway,
                registry_version=registry_version,
                motifs=catalog or None,  # DB에 없으면 전역 registry 폴백(테스트/시드 경로)
            )
        except IntentInvalid as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except (AssertionError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        tile_mm = float(body.intent["canvas"]["tile_mm"])
        intent_log: dict[str, Any] = {"designs": resolved_intents}
    elif body.prompt is not None:
        input_type = "prompt"
        gemini = adapters.gemini
        if gemini is None:
            raise HTTPException(status_code=503, detail="Gemini 미구성 (intent 직접 전달 가능)")

        def _validate(intent_raw: dict) -> list[str] | None:
            normalize_stripes(intent_raw, settings)  # 대각 stripe 코드 계약 — 검증 전 in-place
            try:
                validate_intent(intent_raw, repair=True)
            except IntentInvalid as exc:
                return exc.errors
            return None

        try:
            designs = await gemini.author_designs(body.prompt, validate=_validate)
        except IntentInvalid as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except AdapterClientError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        embedding = request_scoped(adapters.embedding)  # design 간 같은 descriptor 재임베딩 방지
        resolved_intents: list[dict[str, Any]] = []
        try:
            for design in designs:
                # Motif variant selection and candidate composition must share one effective
                # seed. With no request override, generate_candidates uses each authored seed.
                effective_seed = (
                    body.seed if body.seed is not None else int(design.intent.get("seed", 0))
                )
                resolved_intents.append(
                    await resolve_motifs(
                        session,
                        design.intent,
                        design.motif_specs,
                        recraft_client=adapters.recraft,
                        embedding_client=embedding,
                        settings=settings,
                        seed=effective_seed,
                        warnings=warnings,
                    )
                )
        except AdapterNotConfigured as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except AdapterClientError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        ids: set[str] = set()
        for resolved in resolved_intents:
            ids |= iter_motif_ids(resolved)
        catalog = await get_motifs(session, ids)
        registry_version = await registry_version_for(session)  # 풀이 생성으로 바뀌었을 수 있음
        try:
            candidate_set = generate_candidate_set(
                resolved_intents,
                candidate_count=body.candidate_count,
                seed=body.seed,
                colorway=body.colorway,
                registry_version=registry_version,
                motifs=catalog or None,
            )
        except IntentInvalid as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except (AssertionError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        tile_mm = float(resolved_intents[0]["canvas"]["tile_mm"])
        intent_log = {"designs": resolved_intents}
    else:
        raise HTTPException(status_code=422, detail="either intent or prompt is required")

    warnings.extend(candidate_set.warnings)
    warnings = list(dict.fromkeys(warnings))
    generate_ms = round((time.perf_counter() - started) * 1000, 3)
    request.state.generation_generate_ms = generate_ms
    outs = await _render_candidates(candidate_set, tile_mm, request, settings, warnings)

    log = SeamlessGenerationLog(
        request_id=request_id_var.get(),
        input_type=input_type,
        prompt=body.prompt,
        colorway=body.colorway,
        seed=body.seed,
        candidate_count_requested=body.candidate_count,
        candidate_count_returned=len(outs),
        distinct_layouts=len({c.layout_id for c in outs}),
        available_strategies=candidate_set.available_strategy_count,
        engine_version=settings.engine_version,
        registry_version=registry_version,
        intent=intent_log,
        candidates=[c.model_dump() for c in outs],
        warnings=warnings,
        generate_ms=generate_ms,
        render_ms=request.state.generation_render_ms,
        status="partial" if warnings else "success",
    )
    session.add(log)
    await session.commit()
    return GenerateResponse(
        request_id=request_id_var.get(),
        registry_version=registry_version,
        engine_version=settings.engine_version,
        intents=resolved_intents,
        candidates=outs,
        warnings=warnings,
    )


@generate_router.post("/motifs/candidates")
async def motif_candidates(
    body: CandidatesRequest, request: Request, session: SessionDep
) -> dict[str, Any]:
    adapters = request.app.state.adapters
    registry_version = await registry_version_for(session)
    candidates = await present_candidates(
        session, body.spec.model_dump(), embedding_client=adapters.embedding, top_k=body.top_k
    )
    return {
        "request_id": request_id_var.get(),
        "registry_version": registry_version,
        "candidates": candidates,
    }


@generate_router.post("/motifs/generate")
async def motif_generate(
    body: MotifGenerateRequest, request: Request, session: SessionDep
) -> dict[str, Any]:
    settings = request.app.state.settings
    adapters = request.app.state.adapters
    seed = body.seed if body.seed is not None else 0
    try:
        result = await resolve_spec(
            session,
            body.spec.model_dump(),
            recraft_client=adapters.recraft,
            embedding_client=adapters.embedding,
            settings=settings,
            seed=seed,
        )
    except AdapterNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except AdapterClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    await session.commit()
    return {
        "request_id": request_id_var.get(),
        "motif_id": result.motif_id,
        "reused": result.reused,
        "similarity": result.similarity,
    }


@finalize_router.post("/export")
async def export(body: ExportRequest, request: Request) -> Response:
    settings = request.app.state.settings
    if body.dpi > settings.max_dpi:
        raise HTTPException(status_code=400, detail=f"dpi must be <= {settings.max_dpi}")
    if body.width_mm > settings.max_tile_mm or (body.height_mm or 0) > settings.max_tile_mm:
        raise HTTPException(status_code=400, detail=f"size must be <= {settings.max_tile_mm}mm")
    try:
        safe_svg = scrub_svg(body.svg)  # 외부 입력 — 재직렬화로 인젝션 차단
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        data, media = await run_in_threadpool(
            rasterize_svg,
            safe_svg,
            fmt=body.format,
            width_mm=body.width_mm,
            height_mm=body.height_mm,
            dpi=body.dpi,
        )
    except RasterError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(content=data, media_type=media)


@finalize_router.post("/tasks/finalize")
async def finalize_task(
    body: FinalizeTaskRequest, request: Request, session: SessionDep
) -> dict[str, Any]:
    job = await session.scalar(
        select(GenerationJob).where(GenerationJob.id == body.job_id).with_for_update()
    )
    if job is None:
        await session.commit()
        # DB에 없는 task는 재시도해도 생기지 않는다. 2xx로 ACK해 폐기한다.
        return {"status": "ignored", "reason": "job_not_found"}
    if job.kind != "finalize":
        await session.commit()
        return {"status": "ignored", "reason": "job_kind_is_not_finalize"}
    if job.status == "succeeded":
        await session.commit()
        return {"status": "succeeded", "result": job.result}  # 멱등 — Cloud Tasks 재전송
    if job.status == "failed" and job.error_message == FINALIZE_DISPATCH_FAILED_MESSAGE:
        await session.commit()
        # API가 전달 실패를 확정하고 예산을 환불한 job은 늦게 도착한 task가 실행하면 안 된다.
        return {"status": "canceled"}
    if job.status == "failed" and job.error_message != FINALIZE_TEMPORARY_FAILURE_MARKER:
        await session.commit()
        # 입력 오류와 출처를 알 수 없는 legacy 실패는 재실행해도 안전하다는 근거가 없다.
        # 명시적인 일시 실패 marker만 Cloud Tasks 재시도 대상으로 인정하고,
        # terminal 상태는 2xx로 ACK해 재전송을 끝낸다.
        return {"status": "failed"}
    if job.status not in {"queued", "processing", "failed"}:
        await session.commit()
        return {"status": "ignored", "reason": "job_is_not_runnable"}

    if job.status == "processing":
        updated_at = job.updated_at
        if updated_at is None:
            lease_expired = False
        else:
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=UTC)
            lease_expired = datetime.now(UTC) - updated_at >= timedelta(
                seconds=request.app.state.settings.finalize_lease_seconds
            )
        if not lease_expired:
            await session.commit()
            # Cloud Tasks must retry this delivery; acknowledging it could strand a job if the
            # current worker dies. Queue backoff is configured to span the full lease.
            raise HTTPException(status_code=409, detail="job is already processing")

    # processing 전이를 먼저 커밋 — 수십 초 렌더 동안 행 잠금·트랜잭션을 잡고 있지 않는다
    job.status = "processing"
    job.attempts += 1
    job.result = None
    job.error_message = None
    attempt = job.attempts
    params = dict(job.params)
    await session.commit()

    try:
        png = await run_in_threadpool(render_fabric, params, request.app.state.settings)
        key = content_key("fabric", png, "png")
        await request.app.state.object_store.upload_bytes(key, png, "image/png")
    except (FabricError, IntentInvalid, RasterLimitError):
        # 영구 실패(잘못된 intent/weave/colorway 등) — failed 기록 후 200. 재렌더해도 같은
        # 입력은 같은 실패라 Cloud Tasks 재시도가 무의미하다(예산·큐 낭비).
        logger.warning(
            "finalize input rejected (job_id=%s attempt=%s)",
            body.job_id,
            attempt,
            exc_info=True,
        )
        finished = await _finish_job(
            session,
            body.job_id,
            attempt=attempt,
            status="failed",
            error=f"{FINALIZE_INVALID_INPUT_CODE}: {FINALIZE_INVALID_INPUT_MESSAGE}",
        )
        if not finished:
            return {"status": "superseded"}
        return {
            "status": "failed",
            "error": {
                "code": FINALIZE_INVALID_INPUT_CODE,
                "message": FINALIZE_INVALID_INPUT_MESSAGE,
            },
        }
    except Exception as exc:
        # 일시 실패(RasterError 등) — 5xx로 Cloud Tasks 재시도에 위임.
        logger.exception("finalize attempt failed (job_id=%s attempt=%s)", body.job_id, attempt)
        finished = await _finish_job(
            session,
            body.job_id,
            attempt=attempt,
            status="failed",
            error=FINALIZE_TEMPORARY_FAILURE_MARKER,
        )
        if not finished:
            return {"status": "superseded"}
        raise HTTPException(
            status_code=500,
            detail={
                "code": FINALIZE_TEMPORARY_FAILURE_CODE,
                "message": FINALIZE_TEMPORARY_FAILURE_MESSAGE,
            },
        ) from exc

    finished = await _finish_job(
        session,
        body.job_id,
        attempt=attempt,
        status="succeeded",
        result={"object_key": key},
    )
    if not finished:
        return {"status": "superseded"}
    return {"status": "succeeded", "result": {"object_key": key}}


async def _finish_job(
    session,
    job_id: uuid.UUID,
    *,
    attempt: int,
    status: str,
    result: dict | None = None,
    error: str | None = None,
) -> bool:
    job = await session.scalar(
        select(GenerationJob)
        .where(GenerationJob.id == job_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if job is None:
        await session.commit()
        return False
    # A stale lease may have been reclaimed while this attempt was still rendering. Only the
    # current processing attempt may publish a terminal state, so late success/failure is inert.
    if job.status != "processing" or job.attempts != attempt:
        await session.commit()
        return False
    job.status = status
    job.result = result
    job.error_message = error
    await session.commit()
    return True


router = APIRouter()
router.include_router(generate_router)
router.include_router(finalize_router)
