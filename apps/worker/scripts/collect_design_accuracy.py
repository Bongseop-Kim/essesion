"""Collect real model outputs for the design-accuracy corpus (paid; needs --confirm-live).

Runs the same authoring/patch path the worker route uses — retrieval → author → compile →
constraints → validate — and writes observations for eval_design_accuracy.py. Prompts, plans and
provider responses are never printed; only the observation file carries intents.

  uv run python apps/worker/scripts/collect_design_accuracy.py --confirm-live --out obs.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from worker.adapters import AdapterClientError
from worker.adapters.embedding import OpenAIEmbeddingClient
from worker.adapters.llm import (
    AUTHORING_PROMPT_REVISION,
    PATCH_PROMPT_REVISION,
    LLMClient,
)
from worker.authoring.compiler import COMPILER_REVISION
from worker.authoring.retrieval import retrieve_examples
from worker.config import get_settings
from worker.engine.constraints import ConstraintInvalid, apply_generation_constraints
from worker.engine.patch import (
    apply_patch,
    composition_snapshot,
    patch_left_intent_unchanged,
)
from worker.engine.validate import IntentInvalid, validate_intent
from worker.motifs.registry import iter_motif_ids

CORPUS = Path(__file__).with_name("design_accuracy_cases.json")
# 편집 프롬프트는 "원만", "별만"으로 대상을 부른다. 프로덕션은 이 subject를 DB motif meta에서
# 읽어 스냅샷에 싣는다 — fixture 모티프에는 DB 행이 없으므로 같은 맥락을 여기서 공급한다.
MOTIF_SUBJECTS = {"eval-circle": "원", "eval-star": "별"}


def _code_sha() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _make_validator(required_motifs: list[str]):
    """The route's validator: constraints + repair happen before the design is accepted."""

    def _validate(raw: dict[str, Any]) -> list[str] | None:
        try:
            constrained = apply_generation_constraints(raw, warnings=[])
        except ConstraintInvalid as exc:
            return exc.errors
        raw.clear()
        raw.update(constrained)
        try:
            validate_intent(raw, repair=True)
        except IntentInvalid as exc:
            return exc.errors
        used = iter_motif_ids(raw)
        if len(used) > 2:
            return ["each design may use at most 2 distinct motifs"]
        missing = [motif_id for motif_id in required_motifs if motif_id not in used]
        if missing:
            return [f"design must use supplied motif ids: {', '.join(missing)}"]
        return None

    return _validate


async def _initial(
    client: LLMClient, case: dict, *, session, embedding, use_examples: bool
) -> dict[str, Any]:
    motif_ids = list(case.get("input_motif_ids") or [])
    examples: list[dict[str, object]] = []
    status = "disabled"
    example_ids: list[object] = []
    if use_examples:
        retrieval = await retrieve_examples(
            session,
            case["prompt"],
            embedding_client=embedding,
            embedding_model=embedding.model,
            available_motif_count=min(2, len(motif_ids)),
        )
        examples = retrieval.prompt_examples()
        status = retrieval.status
        example_ids = [item.get("example_id") for item in retrieval.diagnostics()]
    diagnostics: dict[str, object] = {}
    authored = await client.author_design(
        case["prompt"],
        validate=_make_validator(motif_ids),
        motif_ids=motif_ids,
        examples=examples,
        diagnostics=diagnostics,
    )
    return {
        "observation": {"case_id": case["id"], "intent": authored.intent},
        "meta": {
            "retrieval_status": status,
            "example_ids": example_ids,
            "attempts": diagnostics.get("authoring_attempts"),
        },
    }


async def _edit(client: LLMClient, case: dict, baseline: dict) -> dict[str, Any]:
    motifs = [
        {"id": motif_id, "subject": MOTIF_SUBJECTS.get(motif_id), "description": None}
        for motif_id in sorted(iter_motif_ids(baseline))
    ]
    diagnostics: dict[str, object] = {}
    patch = await client.author_patch(
        case["prompt"],
        snapshot=composition_snapshot(baseline, motifs=motifs),
        conversation_history=[],
        diagnostics=diagnostics,
    )
    meta = {"axes": patch.changed_axes, "attempts": diagnostics.get("authoring_attempts")}
    if not patch.has_changes:
        reason = patch.out_of_scope_reason
        return {
            "observation": {"case_id": case["id"], "rejection": reason or "out_of_scope"},
            "meta": meta,
        }
    patched = apply_patch(baseline, patch, warnings=[])
    constrained = apply_generation_constraints(patched, warnings=[])
    if patch_left_intent_unchanged(baseline, patched):
        return {"observation": {"case_id": case["id"], "rejection": "no_change"}, "meta": meta}
    return {"observation": {"case_id": case["id"], "intent": constrained}, "meta": meta}


async def _run(args: argparse.Namespace) -> None:
    settings = get_settings()
    api_key = os.environ.get("OPENAI_API_KEY") or settings.openai_api_key
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required (env or .env)")
    database_url = os.environ.get("DATABASE_URL") or settings.database_url
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    cases = corpus["cases"]
    if args.case:
        cases = [case for case in cases if case["id"] in set(args.case)]
    if args.limit:
        cases = cases[: args.limit]

    engine = create_async_engine(database_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    embedding = OpenAIEmbeddingClient(api_key, settings.embedding_model)
    client = LLMClient(api_key, settings.llm_model)

    observations: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    try:
        for case in cases:
            started = time.perf_counter()
            error = None
            result: dict[str, Any] = {}
            try:
                if case["mode"] == "initial":
                    async with session_factory() as session:
                        result = await _initial(
                            client,
                            case,
                            session=session,
                            embedding=embedding,
                            use_examples=not args.no_examples,
                        )
                else:
                    baseline = corpus["fixtures"][case["before"]]
                    result = await _edit(client, case, baseline)
            except (IntentInvalid, ConstraintInvalid) as exc:
                error = type(exc).__name__
            except AdapterClientError:
                error = "provider_error"
            except Exception as exc:  # noqa: BLE001 - a failed case stays in the denominator
                error = type(exc).__name__
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            if result:
                observations.append(result["observation"])
            rows.append(
                {
                    "id": case["id"],
                    "mode": case["mode"],
                    "split": case["split"],
                    "error": error,
                    "latency_ms": elapsed,
                    **(result.get("meta") or {}),
                }
            )
            print(f"{case['id']} {case['mode']:<7} {error or 'ok':<20} {elapsed:>8.1f}ms")
    finally:
        await client.aclose()
        await embedding.aclose()
        await engine.dispose()

    args.out.write_text(json.dumps(observations, ensure_ascii=False), encoding="utf-8")
    meta = {
        "collected_cases": len(cases),
        "written_observations": len(observations),
        "model": settings.llm_model,
        "embedding_model": settings.embedding_model,
        "authoring_prompt_revision": AUTHORING_PROMPT_REVISION,
        "patch_prompt_revision": PATCH_PROMPT_REVISION,
        "compiler_revision": COMPILER_REVISION,
        "corpus_revision": corpus["revision"],
        "motif_subjects": MOTIF_SUBJECTS,
        "examples_enabled": not args.no_examples,
        "code_sha": _code_sha(),
        "cases": rows,
    }
    args.meta.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: meta[key] for key in meta if key != "cases"}, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-live", action="store_true", help="acknowledge paid API calls")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--meta", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--case", action="append")
    # RAG A/B: 같은 사례를 예시 없이 저작해 held-out 비교의 대조군을 만든다.
    parser.add_argument("--no-examples", action="store_true")
    args = parser.parse_args()
    if not args.confirm_live:
        raise SystemExit("Refusing live provider calls without --confirm-live")
    asyncio.run(_run(args))


if __name__ == "__main__":
    main()
