import asyncio
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


async def _render_candidates(
    candidate_set, tile_mm: float, request: Request, settings, warnings: list[str]
) -> list[CandidateOut]:
    """후보 SVG를 프리뷰 래스터화·업로드하고 CandidateOut 목록으로 — 실패는 경고로 격하.

    후보별 렌더+업로드는 병렬(gather), 응답의 후보·경고 순서는 입력 순서 그대로.
    """

    async def _one(ranked) -> tuple[CandidateOut, str | None]:
        png_key = None
        warning = None
        try:
            png, _media = await run_in_threadpool(
                rasterize_svg, ranked.candidate.svg, width_mm=tile_mm, dpi=settings.preview_dpi
            )
            png_key = f"previews/{request_id_var.get()}/{ranked.id}.png"
            await request.app.state.object_store.upload_bytes(png_key, png, "image/png")
        except (RasterError, OSError) as exc:
            warning = f"preview upload skipped: {exc}"
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

    rendered = await asyncio.gather(*(_one(r) for r in candidate_set.candidates))
    outs: list[CandidateOut] = []
    for out, warning in rendered:
        if warning is not None:
            warnings.append(warning)
        outs.append(out)
    return outs


@router.post("/generate", response_model=GenerateResponse)
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

        seed = body.seed if body.seed is not None else 0
        embedding = request_scoped(adapters.embedding)  # design 간 같은 descriptor 재임베딩 방지
        resolved_intents: list[dict[str, Any]] = []
        try:
            for design in designs:
                resolved_intents.append(
                    await resolve_motifs(
                        session,
                        design.intent,
                        design.motif_specs,
                        recraft_client=adapters.recraft,
                        embedding_client=embedding,
                        settings=settings,
                        seed=seed,
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
        generate_ms=round((time.perf_counter() - started) * 1000, 3),
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


@router.post("/motifs/candidates")
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


@router.post("/motifs/generate")
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
    except FabricError as exc:
        # 영구 실패(잘못된 intent/weave/colorway 등) — failed 기록 후 200. 재렌더해도 같은
        # 입력은 같은 실패라 Cloud Tasks 재시도가 무의미하다(예산·큐 낭비).
        await _finish_job(session, body.job_id, status="failed", error=str(exc))
        return {"status": "failed", "error": str(exc)}
    except Exception as exc:
        # 일시 실패(RasterError 등) — 5xx로 Cloud Tasks 재시도에 위임.
        await _finish_job(session, body.job_id, status="failed", error=str(exc))
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
