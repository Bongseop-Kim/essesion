"""Live legacy/v3 authoring evaluation; never run implicitly in tests.

Usage:
  GCP_PROJECT_ID=... DATABASE_URL=... uv run python \
    apps/worker/scripts/eval_authoring.py --confirm-live --pipeline legacy --pipeline v3

V3 reads the deployed immutable example projection and exercises the same Vertex embedding +
pgvector RAG path as the worker. The report contains aggregates and case IDs only; prompt text
and provider responses are never printed or persisted.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
import time
from collections import Counter
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from worker.adapters import AdapterClientError
from worker.adapters.embedding import DEFAULT_MODEL as DEFAULT_EMBEDDING_MODEL
from worker.adapters.embedding import VertexEmbeddingClient
from worker.adapters.gemini import DEFAULT_MODEL, GeminiClient
from worker.authoring.retrieval import retrieve_examples
from worker.engine.constraints import PatternConstraints
from worker.engine.validate import IntentInvalid, validate_intent

DEFAULT_CORPUS = Path(__file__).with_name("authoring_prompts.json")
Pipeline = Literal["legacy", "v3"]


class EvalCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z]{2}-[0-9]{3}$")
    prompt: str = Field(min_length=10, max_length=100)
    motif_count: int = Field(ge=0, le=2)
    expected_families: list[str] = Field(min_length=1)


def _validate(raw: dict) -> list[str] | None:
    try:
        validate_intent(raw, repair=False)
    except IntentInvalid as exc:
        return exc.errors
    return None


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * percentile) - 1))
    return round(ordered[index], 1)


def _intent_fingerprint(intent: dict) -> str:
    """Legacy-compatible geometry hash for cross-pipeline diversity comparison."""

    layers: list[dict[str, object]] = []
    for layer in intent["layers"]:
        layer_type = layer["type"]
        if layer_type == "background":
            layers.append({"type": "background"})
        elif layer_type == "stripe":
            params = layer["params"]
            layers.append(
                {
                    "type": "stripe",
                    "angle": params["angle"],
                    "period_mm": params["period_mm"],
                    "bands": [
                        {
                            "offset_mm": band["offset_mm"],
                            "width_mm": band["width_mm"],
                        }
                        for band in params["bands"]
                    ],
                }
            )
        else:
            layers.append(
                {
                    "type": "motif",
                    "size_mm": layer["params"]["size_mm"],
                    "placement": layer["placement"],
                }
            )
    canonical = json.dumps(layers, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


async def _evaluate_model(
    model: str,
    cases: list[EvalCase],
    project: str,
    *,
    pipeline: Pipeline,
    session: AsyncSession | None = None,
    embedding: VertexEmbeddingClient | None = None,
    embedding_model: str = DEFAULT_EMBEDDING_MODEL,
) -> dict[str, Any]:
    client = GeminiClient(project, model)
    latencies: list[float] = []
    attempts: list[int] = []
    valid_counts: list[int] = []
    diversity_counts: list[int] = []
    failures: Counter[str] = Counter()
    retrieval_statuses: Counter[str] = Counter()
    retrieval_family_hits = 0
    succeeded = 0
    diversity_passed = 0
    try:
        for case in cases:
            diagnostics: dict[str, object] = {}
            motif_ids = [f"recraft-eval{i:011d}" for i in range(1, case.motif_count + 1)]
            examples: list[dict[str, object]] = []
            if pipeline == "v3":
                assert session is not None and embedding is not None
                retrieval = await retrieve_examples(
                    session,
                    case.prompt,
                    embedding_client=embedding,
                    embedding_model=embedding_model,
                    available_motif_count=case.motif_count,
                    pattern_constraints=PatternConstraints(),
                )
                retrieval_statuses[retrieval.status] += 1
                selected_families = {example.family for example in retrieval.examples}
                retrieval_family_hits += int(
                    bool(selected_families.intersection(case.expected_families))
                )
                examples = retrieval.prompt_examples()

            started = time.perf_counter()
            try:
                if pipeline == "v3":
                    designs = await client.author_designs_v3(
                        case.prompt,
                        motif_ids=motif_ids,
                        examples=examples,
                        validate=_validate,
                        diagnostics=diagnostics,
                    )
                else:
                    designs = await client.author_designs(
                        case.prompt,
                        motif_ids=motif_ids,
                        validate=_validate,
                        diagnostics=diagnostics,
                    )
            except IntentInvalid:
                failures["authoring_invalid"] += 1
            except AdapterClientError:
                failures["provider_error"] += 1
            except Exception:
                failures["unexpected_error"] += 1
            else:
                succeeded += 1
                valid_counts.append(len(designs))
                fingerprints = {
                    design.structural_fingerprint or _intent_fingerprint(design.intent)
                    for design in designs
                }
                diversity_counts.append(len(fingerprints))
                diversity_passed += int(len(fingerprints) >= 2)
            finally:
                latencies.append((time.perf_counter() - started) * 1000)
                value = diagnostics.get("authoring_attempts")
                if isinstance(value, int):
                    attempts.append(value)
    finally:
        await client.aclose()

    total = len(cases)
    retrieval_total = sum(retrieval_statuses.values())
    return {
        "model": model,
        "pipeline": pipeline,
        "plan_contract_version": 3 if pipeline == "v3" else 2,
        "total": total,
        "succeeded": succeeded,
        "schema_compile_success_rate": round(succeeded / total, 4) if total else 0,
        "structural_diversity_pass_rate": (
            round(diversity_passed / succeeded, 4) if succeeded else 0
        ),
        "failure_counts": dict(sorted(failures.items())),
        "average_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else None,
        "p95_latency_ms": _percentile(latencies, 0.95),
        "average_authoring_attempts": (
            round(sum(attempts) / len(attempts), 2) if attempts else None
        ),
        "average_valid_designs": (
            round(sum(valid_counts) / len(valid_counts), 2) if valid_counts else None
        ),
        "average_distinct_structures": (
            round(sum(diversity_counts) / len(diversity_counts), 2) if diversity_counts else None
        ),
        "retrieval_status_counts": dict(sorted(retrieval_statuses.items())),
        "retrieval_expected_family_recall": (
            round(retrieval_family_hits / retrieval_total, 4) if retrieval_total else None
        ),
    }


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate live Gemini authoring contracts")
    parser.add_argument("--confirm-live", action="store_true", help="acknowledge paid API calls")
    parser.add_argument("--model", action="append", dest="models")
    parser.add_argument(
        "--pipeline",
        action="append",
        choices=("legacy", "v3"),
        dest="pipelines",
        help="repeat to compare both; defaults to legacy and v3",
    )
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--embedding-model", default=DEFAULT_EMBEDDING_MODEL)
    return parser.parse_args()


async def _main() -> None:
    args = _arguments()
    if not args.confirm_live:
        raise SystemExit("Refusing live provider calls without --confirm-live")
    project = os.environ.get("GCP_PROJECT_ID", "")
    if not project:
        raise SystemExit("GCP_PROJECT_ID is required")
    raw_cases = json.loads(args.corpus.read_text(encoding="utf-8"))
    if not isinstance(raw_cases, list):
        raise SystemExit("corpus must be a JSON array")
    cases = [EvalCase.model_validate(item) for item in raw_cases]
    if args.limit is not None:
        if args.limit < 1:
            raise SystemExit("--limit must be positive")
        cases = cases[: args.limit]
    models = list(dict.fromkeys(args.models or [DEFAULT_MODEL]))
    pipelines: list[Pipeline] = list(dict.fromkeys(args.pipelines or ["legacy", "v3"]))

    engine = None
    embedding = None
    session_factory = None
    if "v3" in pipelines:
        database_url = os.environ.get("DATABASE_URL", "")
        if not database_url:
            raise SystemExit("DATABASE_URL is required for the v3 RAG evaluation")
        engine = create_async_engine(database_url)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        embedding = VertexEmbeddingClient(project, model=args.embedding_model)

    results: list[dict[str, Any]] = []
    try:
        for model in models:
            for pipeline in pipelines:
                if pipeline == "v3":
                    assert session_factory is not None
                    async with session_factory() as session:
                        results.append(
                            await _evaluate_model(
                                model,
                                cases,
                                project,
                                pipeline=pipeline,
                                session=session,
                                embedding=embedding,
                                embedding_model=args.embedding_model,
                            )
                        )
                else:
                    results.append(await _evaluate_model(model, cases, project, pipeline=pipeline))
    finally:
        if embedding is not None:
            await embedding.aclose()
        if engine is not None:
            await engine.dispose()

    print(json.dumps({"corpus_size": len(cases), "results": results}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(_main())
