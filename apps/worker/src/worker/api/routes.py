import logging
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import wraps
from typing import Any, Never, cast
from urllib.parse import urlparse

import httpx
from db.models.design import (
    FINALIZE_DISPATCH_FAILED_MESSAGE,
    FINALIZE_TEMPORARY_FAILURE_CODE,
    FINALIZE_TEMPORARY_FAILURE_MARKER,
    FINALIZE_TEMPORARY_FAILURE_MESSAGE,
    GenerationJob,
)
from db.models.seamless import EMBEDDING_DIM, SeamlessGenerationLog
from fastapi import APIRouter, HTTPException, Request, Response
from obs import request_id_var
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from svg_safety import scrub_svg

from worker.adapters import AdapterClientError, AdapterNotConfigured
from worker.adapters.embedding import request_scoped
from worker.adapters.llm import SemanticMismatch
from worker.adapters.motif_intent import detect_motif_intent
from worker.api.schemas import (
    AuthoringCompilePreviewRequest,
    AuthoringCompilePreviewResponse,
    AuthoringExampleEmbeddingModelResponse,
    AuthoringExamplePrepareRequest,
    AuthoringExamplePrepareResponse,
    CandidatesRequest,
    DesignOut,
    ExportRequest,
    FinalizeTaskRequest,
    GenerateRequest,
    GenerateResponse,
    GenerationWarning,
    IdeasRequest,
    IdeasResponse,
    MotifGenerateRequest,
    MotifImportRequest,
    MotifImportResponse,
    MotifIntentSignal,
    PhotoMotifPreviewRequest,
    PhotoMotifPreviewResponse,
    PromotionEmbeddingRequest,
    PromotionEmbeddingResponse,
    PromotionScanRequest,
    PromotionScanResponse,
    ReferenceImageInput,
    ScopeRejectedResponse,
    TextMotifPreviewRequest,
    TextMotifPreviewResponse,
)
from worker.authoring.compiler import PLAN_CONTRACT_VERSION, PlanCompileError
from worker.authoring.examples import (
    AuthoringFamily,
    analyze_authoring_example,
)
from worker.authoring.examples import (
    embedding_document as authoring_embedding_document,
)
from worker.authoring.preview import prepare_authoring_preview
from worker.authoring.promotion import (
    ensure_candidate_embedding,
    scan_promotion_candidates,
)
from worker.authoring.retrieval import retrieve_examples
from worker.authoring.schema import DesignPlanV3, snapshot_resolved_plan, structural_fingerprint
from worker.db import SessionDep
from worker.engine import (
    ComposedDesign,
    IntentInvalid,
    compose_design,
    validate_intent,
)
from worker.engine.composition import compose
from worker.engine.constraints import ConstraintInvalid, apply_generation_constraints
from worker.engine.patch import apply_patch, composition_snapshot, set_motif_slot
from worker.engine.seamless import assert_seamless_invariants
from worker.integrations import content_key
from worker.motifs.fingerprint import registry_version_for
from worker.motifs.normalize import normalize_motif_svg
from worker.motifs.photo_svg import photo_to_svg
from worker.motifs.registry import iter_motif_ids
from worker.motifs.resolver import (
    MotifGenerationBudget,
    present_candidates,
    prompt_catalog_candidates,
    resolve_spec,
)
from worker.motifs.store import get_motifs
from worker.motifs.text_svg import text_to_svg
from worker.render.fabric import FabricError, render_fabric
from worker.render.raster import RasterError, RasterLimitError, rasterize_svg
from worker.warnings import customer_warnings

generate_router = APIRouter()
finalize_router = APIRouter()
logger = logging.getLogger(__name__)

FINALIZE_INVALID_INPUT_CODE = "FINALIZE_INVALID_INPUT"
FINALIZE_INVALID_INPUT_MESSAGE = "finalize input is invalid"

GENERATION_ERROR_MESSAGES = {
    "authoring_invalid": "the design plan could not be authored",
    "constraint_conflict": "the selected design constraints conflict",
    "intent_invalid": "the design input is invalid",
    "design_invalid": "the design could not be composed",
    "semantic_mismatch": "the design plan did not match the requested subject",
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
    if isinstance(source, AdapterNotConfigured):
        return error_type, "generation adapter is not configured"
    if isinstance(source, AdapterClientError):
        return error_type, "generation adapter request failed"
    if isinstance(source, (AssertionError, ValueError)):
        return error_type, "generation input is invalid"
    if isinstance(exc, HTTPException):
        return "HTTPException", f"generation request rejected ({exc.status_code})"
    return error_type, "generation failed"


def _record_adapter_failure(
    request: Request,
    exc: AdapterClientError,
    *,
    stage: str,
    duration_ms: float | None = None,
    emit_log: bool = True,
) -> None:
    diagnostics = request.state.generation_diagnostics
    diagnostics.update(
        {
            "failure_code": "provider_request_failed",
            "failure_stage": stage,
            "failure_provider": exc.provider,
            "failure_operation": exc.operation,
            "failure_reason": exc.reason_code,
            "failure_status_code": exc.status_code,
        }
    )
    if emit_log:
        logger.warning(
            "generation provider call failed",
            extra={
                "event": "provider_call_failed",
                "stage": stage,
                "provider": exc.provider,
                "operation": exc.operation,
                "reason_code": exc.reason_code,
                "status_code": exc.status_code,
                "duration_ms": duration_ms,
                "attempt": diagnostics.get("authoring_attempts"),
            },
        )


def _logged_generation(endpoint):  # noqa: ANN001 — FastAPI signature preserved by wraps
    @wraps(endpoint)
    async def wrapped(body: GenerateRequest, request: Request, session: SessionDep):
        started = time.perf_counter()
        request.state.generation_generate_ms = None
        request.state.generation_render_ms = 0.0
        request.state.generation_diagnostics = {
            "mode": (
                "motif_slot"
                if body.motif_slot is not None
                else "variation"
                if body.intent is not None
                else "patch"
                if body.conversation_context is not None
                else "prompt"
            ),
            "motif_resolutions": [],
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
                    input_type="intent" if body.intent is not None else "prompt",
                    prompt=body.prompt,
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
    input_type: str
    design: ComposedDesign
    resolved_intent: dict[str, Any]
    tile_mm: float
    intent_log: dict[str, Any]
    registry_version: str
    plan: dict[str, Any] | None
    structural_fingerprint: str | None
    # 구성 patch가 사용자 문장을 해석한 한 줄. 최초 저작은 None.
    note: str | None = None
    motif_intent: dict[str, object] | None = None


async def _generate_from_intent(
    body: GenerateRequest,
    request: Request,
    session: AsyncSession,
    *,
    effective_colorway: str | None,
    registry_version: str,
    warnings: list[str],
) -> _GenerateOutcome:
    assert body.intent is not None
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
            colorway=effective_colorway,
            motifs=catalog or None,  # DB에 없으면 전역 registry 폴백(테스트/시드 경로)
        )
    except IntentInvalid:
        _reject_generation(request, "intent_invalid", "intent")
    except (AssertionError, ValueError):
        # 검증 통과 후의 합성 실패 — 프롬프트 경로와 동일한 실패 코드로.
        _reject_generation(request, "design_invalid", "design")
    finally:
        request.state.generation_diagnostics["compose_ms"] = round(
            (time.perf_counter() - compose_started) * 1000, 3
        )
    return _GenerateOutcome(
        input_type="intent",
        design=design,
        resolved_intent=constrained_intent,
        tile_mm=float(constrained_intent["canvas"]["tile_mm"]),
        intent_log={
            "design": constrained_intent,
            "resolved_plan": None,
            **({"motif_slot": body.motif_slot.model_dump()} if body.motif_slot is not None else {}),
        },
        registry_version=registry_version,
        plan=None,
        structural_fingerprint=None,
    )


async def _generate_from_prompt(
    body: GenerateRequest,
    request: Request,
    session: AsyncSession,
    *,
    settings,  # noqa: ANN001
    adapters,  # noqa: ANN001
    effective_colorway: str | None,
    registry_version: str,
    warnings: list[str],
) -> _GenerateOutcome:
    llm = adapters.llm
    if llm is None:
        exc = AdapterNotConfigured(
            "OpenAI LLM 미구성 (intent 직접 전달 가능)",
            provider="openai",
            operation="chat_completions",
            reason_code="not_configured",
        )
        _record_adapter_failure(request, exc, stage="authoring")
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    def _validate(intent_raw: dict) -> list[str] | None:
        # 거절된 재시도의 경고까지 응답에 새지 않도록, 통과한 설계에서만 warnings로 옮긴다.
        constraint_warnings: list[str] = []
        try:
            constrained = apply_generation_constraints(
                intent_raw,
                warnings=constraint_warnings,
            )
        except ConstraintInvalid as exc:
            return exc.errors
        intent_raw.clear()
        intent_raw.update(constrained)
        try:
            validate_intent(intent_raw, repair=True)
        except IntentInvalid as exc:
            return exc.errors
        used = iter_motif_ids(intent_raw)
        if len(used) > 2:
            return ["each design may use at most 2 distinct motifs"]
        missing = [motif_id for motif_id in body.motif_ids if motif_id not in used]
        if missing:
            return [f"design must use supplied motif ids: {', '.join(missing)}"]
        warnings.extend(constraint_warnings)
        return None

    author_prompt = body.prompt or (
        "Create a balanced necktie pattern using the supplied SVG motif."
    )
    embedding = request_scoped(adapters.embedding)
    catalog_candidates: list[dict[str, object]] = []
    if body.prompt and not body.motif_ids:
        catalog_candidates = await prompt_catalog_candidates(
            session,
            body.prompt,
            embedding_client=embedding,
            tau=settings.motif_similarity_tau,
            top_k=5,
        )
    request.state.generation_diagnostics["catalog_candidate_count"] = len(catalog_candidates)
    retrieval_started = time.perf_counter()
    # 사용 가능한 concrete source 수보다 모티프가 많은 예시는 저작 문맥에서 제외한다.
    available_motif_count = min(2, len(body.motif_ids) + len(catalog_candidates))
    async with request.app.state.sessionmaker() as retrieval_session:
        retrieval = await retrieve_examples(
            retrieval_session,
            author_prompt,
            embedding_client=embedding,
            embedding_model=getattr(embedding, "model", settings.embedding_model),
            available_motif_count=available_motif_count,
        )
    prompt_examples = retrieval.prompt_examples()
    request.state.generation_diagnostics.update(
        {
            "example_retrieval_status": retrieval.status,
            "example_retrieval_reason": retrieval.reason,
            "example_retrieval_ms": round(
                (time.perf_counter() - retrieval_started) * 1000,
                3,
            ),
            "selected_examples": retrieval.diagnostics(),
        }
    )

    authoring_started = time.perf_counter()
    try:
        authored = await llm.author_design(
            author_prompt,
            validate=_validate,
            motif_ids=body.motif_ids,
            catalog_candidates=catalog_candidates,
            examples=prompt_examples,
            diagnostics=request.state.generation_diagnostics,
        )
    except SemanticMismatch as exc:
        request.state.generation_diagnostics["authoring_validation_errors"] = list(exc.errors)
        _reject_generation(request, "semantic_mismatch", "authoring")
    except IntentInvalid as exc:
        request.state.generation_diagnostics["authoring_validation_errors"] = list(exc.errors)
        _reject_generation(request, "authoring_invalid", "authoring")
    except AdapterClientError as exc:
        _record_adapter_failure(
            request,
            exc,
            stage="authoring",
            duration_ms=round((time.perf_counter() - authoring_started) * 1000, 3),
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        request.state.generation_diagnostics["authoring_ms"] = round(
            (time.perf_counter() - authoring_started) * 1000, 3
        )

    request.state.generation_diagnostics["motif_resolutions"].extend(authored.motif_resolutions)
    # 자리를 못 찾은 지명색은 조용히 버리지 않고 고객 경고 1건으로 내린다.
    warnings.extend(
        f"named color {name} has no visible slot" for name in authored.unassigned_named_colors
    )
    resolved_intent = authored.intent

    resolved_plan: DesignPlanV3 | None = None
    try:
        if authored.plan is not None:
            resolved_plan = snapshot_resolved_plan(
                DesignPlanV3.model_validate(authored.plan), resolved_intent
            )
    except (TypeError, ValueError):
        _reject_generation(request, "intent_invalid", "intent")

    catalog = await get_motifs(session, iter_motif_ids(resolved_intent))
    compose_started = time.perf_counter()
    try:
        design = compose_design(
            resolved_intent,
            seed=body.seed,
            colorway=effective_colorway,
            motifs=catalog or None,
        )
    except (IntentInvalid, AssertionError, ValueError):
        _reject_generation(request, "design_invalid", "design")
    finally:
        request.state.generation_diagnostics["compose_ms"] = round(
            (time.perf_counter() - compose_started) * 1000, 3
        )
    intent_log: dict[str, Any] = {
        "design": resolved_intent,
        "resolved_plan": resolved_plan.model_dump(mode="json") if resolved_plan else None,
    }
    if authored.plan is not None:
        diagnostics = request.state.generation_diagnostics
        intent_log["authoring"] = {
            "plan_contract_version": diagnostics.get("plan_contract_version"),
            "compiler_revision": diagnostics.get("compiler_revision"),
            "prompt_revision": diagnostics.get("prompt_revision"),
            "selected_example_ids": [
                example.get("example_id")
                for example in diagnostics.get("selected_examples", [])
                if isinstance(example, dict)
            ],
            "plan": authored.plan,
            "structural_fingerprint": authored.structural_fingerprint,
        }
    return _GenerateOutcome(
        input_type="prompt",
        design=design,
        resolved_intent=resolved_intent,
        tile_mm=float(resolved_intent["canvas"]["tile_mm"]),
        intent_log=intent_log,
        registry_version=registry_version,
        plan=resolved_plan.model_dump(mode="json") if resolved_plan else None,
        structural_fingerprint=(structural_fingerprint(resolved_plan) if resolved_plan else None),
        motif_intent=authored.motif_intent,
    )


async def _generate_from_patch(
    body: GenerateRequest,
    request: Request,
    session: AsyncSession,
    *,
    adapters,  # noqa: ANN001
    effective_colorway: str | None,
    registry_version: str,
    warnings: list[str],
) -> _GenerateOutcome | ScopeRejectedResponse:
    """구성 수정 — 문장 → 좁은 patch → 결정론 적용. 모델은 모티프를 볼 수 없다."""

    context = body.conversation_context
    assert context is not None and body.prompt is not None
    llm = adapters.llm
    if llm is None:
        exc = AdapterNotConfigured(
            "OpenAI LLM 미구성 (구성 수정은 저작 모델이 필요하다)",
            provider="openai",
            operation="chat_completions",
            reason_code="not_configured",
        )
        _record_adapter_failure(request, exc, stage="authoring")
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    authoring_started = time.perf_counter()
    try:
        patch = await llm.author_patch(
            body.prompt,
            snapshot=composition_snapshot(context.current_intent),
            conversation_history=[item.model_dump(mode="json") for item in context.history],
            diagnostics=request.state.generation_diagnostics,
        )
    except IntentInvalid as exc:
        request.state.generation_diagnostics["authoring_validation_errors"] = list(exc.errors)
        _reject_generation(request, "authoring_invalid", "authoring")
    except AdapterClientError as exc:
        _record_adapter_failure(
            request,
            exc,
            stage="authoring",
            duration_ms=round((time.perf_counter() - authoring_started) * 1000, 3),
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        request.state.generation_diagnostics["authoring_ms"] = round(
            (time.perf_counter() - authoring_started) * 1000, 3
        )

    request.state.generation_diagnostics["patch_axes"] = patch.changed_axes
    motif_intent = detect_motif_intent(body.prompt, llm_out_of_scope=patch.out_of_scope)
    if motif_intent is not None:
        request.state.generation_diagnostics["motif_intent"] = motif_intent
    if not patch.has_changes:
        # 아무것도 만들지 않았다 — api가 과금을 되돌리고 턴도 남기지 않는다.
        request.state.generation_diagnostics["failure_code"] = "scope_rejected"
        request.state.generation_diagnostics["failure_stage"] = "authoring"
        return ScopeRejectedResponse(
            motif_intent=MotifIntentSignal.model_validate(motif_intent) if motif_intent else None
        )

    try:
        patched = apply_patch(context.current_intent, patch)
        constrained_intent = apply_generation_constraints(patched, warnings=warnings)
    except ConstraintInvalid:
        _reject_generation(request, "constraint_conflict", "constraints")

    catalog = await get_motifs(session, iter_motif_ids(constrained_intent))
    compose_started = time.perf_counter()
    try:
        design = compose_design(
            constrained_intent,
            seed=body.seed,
            colorway=effective_colorway,
            motifs=catalog or None,
        )
    except IntentInvalid:
        _reject_generation(request, "intent_invalid", "intent")
    except (AssertionError, ValueError):
        _reject_generation(request, "design_invalid", "design")
    finally:
        request.state.generation_diagnostics["compose_ms"] = round(
            (time.perf_counter() - compose_started) * 1000, 3
        )
    return _GenerateOutcome(
        input_type="prompt",
        design=design,
        resolved_intent=constrained_intent,
        tile_mm=float(constrained_intent["canvas"]["tile_mm"]),
        intent_log={
            "design": constrained_intent,
            "resolved_plan": None,
            "patch": patch.model_dump(mode="json", exclude_none=True),
        },
        registry_version=registry_version,
        plan=None,
        structural_fingerprint=None,
        note=patch.note,
        motif_intent=motif_intent,
    )


@generate_router.post("/generate", response_model=GenerateResponse | ScopeRejectedResponse)
@_logged_generation
async def generate(
    body: GenerateRequest, request: Request, session: SessionDep
) -> GenerateResponse | ScopeRejectedResponse:
    started = time.perf_counter()
    settings = request.app.state.settings
    adapters = request.app.state.adapters
    registry_version = await registry_version_for(session)
    warnings: list[str] = []
    effective_colorway = body.colorway

    if body.intent is not None:
        outcome = await _generate_from_intent(
            body,
            request,
            session,
            effective_colorway=effective_colorway,
            registry_version=registry_version,
            warnings=warnings,
        )
    elif body.conversation_context is not None:
        outcome = await _generate_from_patch(
            body,
            request,
            session,
            adapters=adapters,
            effective_colorway=effective_colorway,
            registry_version=registry_version,
            warnings=warnings,
        )
        if isinstance(outcome, ScopeRejectedResponse):
            await _log_scope_rejection(session, body, request)
            return outcome
    else:
        outcome = await _generate_from_prompt(
            body,
            request,
            session,
            settings=settings,
            adapters=adapters,
            effective_colorway=effective_colorway,
            registry_version=registry_version,
            warnings=warnings,
        )
    registry_version = outcome.registry_version

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
        input_type=outcome.input_type,
        prompt=body.prompt,
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
        plan=outcome.plan,
        structural_fingerprint=outcome.structural_fingerprint,
        design=out,
        # 진단 문자열은 로그에만 남기고 응답에는 고객 문구가 있는 경고만 내린다.
        warnings=[GenerationWarning(**item) for item in customer_warnings(warnings)],
        note=outcome.note,
        motif_intent=(
            MotifIntentSignal.model_validate(outcome.motif_intent) if outcome.motif_intent else None
        ),
    )


async def _log_scope_rejection(
    session: AsyncSession, body: GenerateRequest, request: Request
) -> None:
    """범위 밖 거절도 한 행 남긴다 — 결과가 없으니 status는 error다(과금은 api가 되돌린다)."""

    # 로그 실패가 거절 응답을 500으로 바꾸지 않게 한다 — 데코레이터의 에러 로그와 같은 규칙.
    try:
        await session.rollback()
        session.add(
            SeamlessGenerationLog(
                id=body.run_id,
                request_id=request_id_var.get(),
                session_id=body.session_id,
                user_id=body.user_id,
                input_type="prompt",
                prompt=body.prompt,
                colorway=body.colorway,
                seed=body.seed,
                warnings=[],
                status="error",
                error_type="ScopeRejected",
                error_message="request is outside the composition patch scope",
                diagnostics=request.state.generation_diagnostics,
            )
        )
        await session.commit()
    except Exception:
        logger.exception("scope rejection log persistence failed")


@generate_router.post(
    "/authoring/compile-preview",
    response_model=AuthoringCompilePreviewResponse,
)
async def compile_authoring_preview(
    body: AuthoringCompilePreviewRequest,
    session: SessionDep,
) -> AuthoringCompilePreviewResponse:
    try:
        prepared = await prepare_authoring_preview(
            session,
            body.plan,
            motif_ids=body.motif_ids,
            tile_mm=body.tile_mm,
            seed=body.seed,
        )
        validated = validate_intent(prepared.design.intent)
        assert_seamless_invariants(validated.intent)
        svg = compose(
            validated.intent,
            validated.palette,
            body.colorway or "default",
            motifs=prepared.motifs,
        )
    except (PlanCompileError, IntentInvalid, AssertionError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    warnings = [*prepared.warnings, *validated.warnings]
    return AuthoringCompilePreviewResponse(
        svg=svg,
        warnings=list(dict.fromkeys(warnings)),
    )


@generate_router.post(
    "/authoring/examples/prepare",
    response_model=AuthoringExamplePrepareResponse,
)
async def prepare_authoring_example(
    body: AuthoringExamplePrepareRequest,
    request: Request,
) -> AuthoringExamplePrepareResponse:
    analysis = analyze_authoring_example(body.retrieval_text, body.plan)
    embedding_client = request.app.state.adapters.embedding
    if embedding_client is None:
        raise HTTPException(status_code=503, detail="authoring embedding is unavailable")
    try:
        embedding = await embedding_client.embed(
            authoring_embedding_document(
                cast(str, analysis["retrieval_text"]),
                cast(AuthoringFamily, analysis["family"]),
                cast(list[str], analysis["tags"]),
            )
        )
    except AdapterClientError as exc:
        raise HTTPException(status_code=502, detail="authoring embedding failed") from exc
    if len(embedding) != EMBEDDING_DIM:
        raise HTTPException(status_code=502, detail="authoring embedding dimension mismatch")
    return AuthoringExamplePrepareResponse.model_validate(
        {
            "contract_version": PLAN_CONTRACT_VERSION,
            **analysis,
            "embedding_model": embedding_client.model,
            "embedding": embedding,
        }
    )


@generate_router.post(
    "/authoring/examples/embedding-model",
    response_model=AuthoringExampleEmbeddingModelResponse,
)
async def get_authoring_example_embedding_model(
    request: Request,
) -> AuthoringExampleEmbeddingModelResponse:
    embedding_client = request.app.state.adapters.embedding
    if embedding_client is None:
        raise HTTPException(status_code=503, detail="authoring embedding is unavailable")
    return AuthoringExampleEmbeddingModelResponse(model=embedding_client.model)


@generate_router.post(
    "/authoring/promotions/scan",
    response_model=PromotionScanResponse,
)
async def scan_authoring_promotions(
    body: PromotionScanRequest,
    request: Request,
    session: SessionDep,
) -> PromotionScanResponse:
    try:
        result = await scan_promotion_candidates(
            session,
            embedding_client=request.app.state.adapters.embedding,
            limit=body.limit,
        )
    except AdapterNotConfigured as exc:
        raise HTTPException(status_code=503, detail="authoring embedding is unavailable") from exc
    except AdapterClientError as exc:
        raise HTTPException(status_code=502, detail="authoring embedding failed") from exc
    return PromotionScanResponse(**result.__dict__)


@generate_router.post(
    "/authoring/promotions/embedding",
    response_model=PromotionEmbeddingResponse,
)
async def ensure_authoring_promotion_embedding(
    body: PromotionEmbeddingRequest,
    request: Request,
    session: SessionDep,
) -> PromotionEmbeddingResponse:
    try:
        model = await ensure_candidate_embedding(
            session,
            candidate_id=body.candidate_id,
            embedding_client=request.app.state.adapters.embedding,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="authoring candidate not found") from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=409, detail="authoring candidate is not reviewable"
        ) from exc
    except AdapterNotConfigured as exc:
        raise HTTPException(status_code=503, detail="authoring embedding is unavailable") from exc
    except AdapterClientError as exc:
        raise HTTPException(status_code=502, detail="authoring embedding failed") from exc
    return PromotionEmbeddingResponse(embedding_model=model)


@generate_router.post("/motifs/candidates")
async def motif_candidates(
    body: CandidatesRequest, request: Request, session: SessionDep
) -> dict[str, Any]:
    """문장을 그대로 카탈로그에서 검색한다. Recraft 미호출이라 과금이 없다."""
    adapters = request.app.state.adapters
    registry_version = await registry_version_for(session)
    # generate와 같은 spec을 써야 여기서 보여준 후보와 생성 경로의 재사용 판정이 일치한다.
    spec = {"subject": body.query, "scope": "whole"}
    candidates = await present_candidates(
        session,
        spec,
        embedding_client=adapters.embedding,
        top_k=body.top_k,
        tau=request.app.state.settings.motif_similarity_tau,
    )
    return {
        "request_id": request_id_var.get(),
        "registry_version": registry_version,
        "candidates": candidates,
    }


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


@generate_router.post("/ideas", response_model=IdeasResponse)
async def suggest_ideas(body: IdeasRequest, request: Request) -> IdeasResponse:
    llm = request.app.state.adapters.llm
    if llm is None:
        raise HTTPException(status_code=503, detail="OpenAI LLM is not configured")
    try:
        ideas = await llm.suggest_ideas(
            body.prompt,
            count=body.count,
            motifs=[motif.model_dump() for motif in body.motifs],
        )
    except AdapterClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return IdeasResponse(ideas=ideas)


@generate_router.post("/motifs/text-preview", response_model=TextMotifPreviewResponse)
async def text_motif_preview(
    body: TextMotifPreviewRequest, request: Request
) -> TextMotifPreviewResponse:
    try:
        svg = await run_in_threadpool(
            text_to_svg,
            body.text,
            font_id=body.font_id,
            font_weight=body.font_weight,
            letter_spacing=body.letter_spacing,
        )
        svg = await _normalize_preview_svg(svg, request, id_prefix="text-preview")
    except (ValueError, TypeError, RecursionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return TextMotifPreviewResponse(svg=svg)


@generate_router.post("/motifs/photo-preview", response_model=PhotoMotifPreviewResponse)
async def photo_motif_preview(
    body: PhotoMotifPreviewRequest, request: Request
) -> PhotoMotifPreviewResponse:
    data = await _load_single_image(body.image, request.app.state.settings)
    try:
        result = await run_in_threadpool(
            photo_to_svg,
            data,
            body.image.content_type,
            remove_background=body.remove_background,
            simplification=body.simplification,
            color_count=body.color_count,
        )
        svg = await _normalize_preview_svg(result.svg, request, id_prefix="photo-preview")
    except (ValueError, TypeError, RecursionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return PhotoMotifPreviewResponse(
        svg=svg,
        processed_preview_base64=result.processed_preview_base64,
        background_confidence=result.background_confidence,
        warnings=result.warnings,
    )


@generate_router.post("/motifs/import", response_model=MotifImportResponse)
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


@generate_router.post("/motifs/generate")
async def motif_generate(
    body: MotifGenerateRequest, request: Request, session: SessionDep
) -> dict[str, Any]:
    settings = request.app.state.settings
    adapters = request.app.state.adapters
    spec = {"subject": body.query, "scope": "whole"}
    try:
        result = await resolve_spec(
            session,
            spec,
            recraft_client=adapters.recraft,
            embedding_client=adapters.embedding,
            settings=settings,
            seed=0,
            provenance=(
                body.motif_provenance.model_dump() if body.motif_provenance is not None else None
            ),
            generation_budget=MotifGenerationBudget(settings.motif_generate_per_request_limit),
        )
    except AdapterNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except AdapterClientError as exc:
        if exc.reason_code == "unsafe_motif_facet":
            raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    if job.status == "canceled":
        await session.commit()
        # API가 취소를 확정하고 예산을 환불한 job — 늦게 도착한 task는 실행하지 않고 ACK.
        return {"status": "canceled"}
    if job.status == "failed" and job.error_message == FINALIZE_DISPATCH_FAILED_MESSAGE:
        await session.commit()
        # API가 전달 실패를 확정하고 예산을 환불한 job은 늦게 도착한 task가 실행하면 안 된다.
        return {"status": "canceled"}
    if job.status == "failed" and job.error_message != FINALIZE_TEMPORARY_FAILURE_MARKER:
        await session.commit()
        # 입력 오류와 원인이 분류되지 않은 실패는 재실행해도 안전하다는 근거가 없다.
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
    job.started_at = datetime.now(UTC)  # 재시도는 현재 attempt 기준으로 덮어쓴다
    job.finished_at = None
    attempt = job.attempts
    params = dict(job.params)
    await session.commit()

    # generate와 동일하게 DB 모티프 카탈로그를 렌더에 공급 — 빈 카탈로그는 전역
    # registry 폴백(테스트/시드 경로). 미등록 모티프는 render_fabric이 영구 실패 처리.
    motif_catalog = await get_motifs(session, iter_motif_ids(params.get("intent"))) or None

    try:
        png = await run_in_threadpool(
            render_fabric, params, request.app.state.settings, motif_catalog
        )
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
    job.finished_at = datetime.now(UTC)
    await session.commit()
    return True


router = APIRouter()
router.include_router(generate_router)
router.include_router(finalize_router)
