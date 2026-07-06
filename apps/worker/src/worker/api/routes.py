import time
import uuid
from typing import Any, Literal

from db.models.design import GenerationJob
from db.models.seamless import SeamlessGenerationLog
from fastapi import APIRouter, HTTPException, Request, Response
from obs import request_id_var
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from worker.db import SessionDep
from worker.engine import IntentInvalid, generate_candidates
from worker.integrations import content_key
from worker.render.fabric import render_fabric
from worker.render.raster import RasterError, rasterize_svg
from worker.render.sanitize import scrub_svg

router = APIRouter()

NOT_IMPLEMENTED = 501


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


@router.post("/generate", response_model=GenerateResponse)
async def generate(
    body: GenerateRequest, request: Request, session: SessionDep
) -> GenerateResponse:
    started = time.perf_counter()
    settings = request.app.state.settings
    if body.intent is None:
        # prompt 저작(Gemini)은 어댑터 구현 후 — 가짜 intent로 200을 주지 않는다
        raise HTTPException(
            status_code=NOT_IMPLEMENTED, detail="prompt 기반 생성은 아직 미구현 (intent 직접 전달)"
        )

    try:
        candidate_set = generate_candidates(
            body.intent,
            candidate_count=body.candidate_count,
            seed=body.seed,
            colorway=body.colorway,
            registry_version=settings.registry_version,
        )
    except IntentInvalid as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (AssertionError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    warnings = list(candidate_set.warnings)
    tile_mm = float(body.intent["canvas"]["tile_mm"])

    outs: list[CandidateOut] = []
    for ranked in candidate_set.candidates:
        png_key = None
        try:
            png, _media = await run_in_threadpool(
                rasterize_svg,
                ranked.candidate.svg,
                width_mm=tile_mm,
                dpi=settings.preview_dpi,
            )
            png_key = f"previews/{request_id_var.get()}/{ranked.id}.png"
            await request.app.state.object_store.upload_bytes(png_key, png, "image/png")
        except (RasterError, OSError) as exc:
            warnings.append(f"preview upload skipped: {exc}")
        outs.append(
            CandidateOut(
                id=ranked.id,
                design_index=ranked.design_index,
                layout_id=ranked.candidate.layout_id or "",
                source_fidelity=ranked.source_fidelity,
                colorway_id=ranked.colorway_id,
                seed=ranked.seed,
                svg=ranked.candidate.svg,
                png_object_key=png_key,
            )
        )

    log = SeamlessGenerationLog(
        request_id=request_id_var.get(),
        input_type="intent",
        prompt=body.prompt,
        colorway=body.colorway,
        seed=body.seed if body.seed is not None else body.intent.get("seed"),
        candidate_count_requested=body.candidate_count,
        candidate_count_returned=len(outs),
        distinct_layouts=len({c.layout_id for c in outs}),
        available_strategies=candidate_set.available_strategy_count,
        engine_version=settings.engine_version,
        registry_version=settings.registry_version,
        intent={"designs": [body.intent]},
        candidates=[c.model_dump() for c in outs],
        warnings=warnings,
        generate_ms=round((time.perf_counter() - started) * 1000, 3),
        status="partial" if warnings else "success",
    )
    session.add(log)
    await session.commit()
    return GenerateResponse(
        request_id=request_id_var.get(),
        registry_version=settings.registry_version,
        engine_version=settings.engine_version,
        candidates=outs,
        warnings=warnings,
    )


@router.post("/motifs/candidates")
async def motif_candidates() -> None:
    raise HTTPException(
        status_code=NOT_IMPLEMENTED, detail="모티프 검색(pgvector store)은 아직 미구현"
    )


@router.post("/motifs/generate")
async def motif_generate() -> None:
    raise HTTPException(status_code=NOT_IMPLEMENTED, detail="Recraft 모티프 생성은 아직 미구현")


@router.post("/export")
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


@router.post("/tasks/finalize")
async def finalize_task(
    body: FinalizeTaskRequest, request: Request, session: SessionDep
) -> dict[str, Any]:
    job = await session.scalar(
        select(GenerationJob).where(GenerationJob.id == body.job_id).with_for_update()
    )
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if job.status == "succeeded":
        await session.commit()
        return {"status": "succeeded", "result": job.result}  # 멱등 — Cloud Tasks 재전송
    if job.status not in {"queued", "processing", "failed"}:
        await session.commit()
        raise HTTPException(status_code=409, detail="job is not runnable")

    # processing 전이를 먼저 커밋 — 수십 초 렌더 동안 행 잠금·트랜잭션을 잡고 있지 않는다
    job.status = "processing"
    job.attempts += 1
    params = dict(job.params)
    await session.commit()

    try:
        png = await run_in_threadpool(render_fabric, params, request.app.state.settings)
        key = content_key("fabric", png, "png")
        await request.app.state.object_store.upload_bytes(key, png, "image/png")
    except Exception as exc:
        await _finish_job(session, body.job_id, status="failed", error=str(exc))
        # 5xx → Cloud Tasks가 재시도 (FabricError 등 영구 실패도 큐 재시도 상한이 정리)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    await _finish_job(session, body.job_id, status="succeeded", result={"object_key": key})
    return {"status": "succeeded", "result": {"object_key": key}}


async def _finish_job(
    session, job_id: uuid.UUID, *, status: str, result: dict | None = None, error: str | None = None
) -> None:
    job = await session.scalar(
        select(GenerationJob).where(GenerationJob.id == job_id).with_for_update()
    )
    if job is None:
        return
    job.status = status
    job.result = result
    job.error_message = error
    await session.commit()
