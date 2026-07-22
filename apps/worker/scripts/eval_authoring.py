"""Live Gemini authoring contract evaluation; never run implicitly in tests.

Usage:
  GCP_PROJECT_ID=... uv run python apps/worker/scripts/eval_authoring.py \
    --confirm-live --model gemini-2.5-flash-lite

The report contains aggregate metrics and corpus indexes only. Prompt text and provider
responses are intentionally not printed or persisted.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import time
from collections import Counter
from pathlib import Path
from typing import Any

from worker.adapters import AdapterClientError
from worker.adapters.gemini import DEFAULT_MODEL, GeminiClient
from worker.engine.validate import IntentInvalid, validate_intent

DEFAULT_CORPUS = Path(__file__).with_name("authoring_prompts.json")


def _validate(raw: dict) -> list[str] | None:
    try:
        validate_intent(raw, repair=True)
    except IntentInvalid as exc:
        return exc.errors
    return None


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * percentile) - 1))
    return round(ordered[index], 1)


async def _evaluate_model(model: str, prompts: list[str], project: str) -> dict[str, Any]:
    client = GeminiClient(project, model)
    latencies: list[float] = []
    attempts: list[int] = []
    valid_counts: list[int] = []
    failures: Counter[str] = Counter()
    succeeded = 0
    try:
        for prompt in prompts:
            diagnostics: dict[str, object] = {}
            started = time.perf_counter()
            try:
                designs = await client.author_designs(
                    prompt, validate=_validate, diagnostics=diagnostics
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
            finally:
                latencies.append((time.perf_counter() - started) * 1000)
                value = diagnostics.get("authoring_attempts")
                if isinstance(value, int):
                    attempts.append(value)
    finally:
        await client.aclose()

    total = len(prompts)
    return {
        "model": model,
        "total": total,
        "succeeded": succeeded,
        "success_rate": round(succeeded / total, 4) if total else 0,
        "failure_counts": dict(sorted(failures.items())),
        "average_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else None,
        "p95_latency_ms": _percentile(latencies, 0.95),
        "average_authoring_attempts": (
            round(sum(attempts) / len(attempts), 2) if attempts else None
        ),
        "average_valid_designs": (
            round(sum(valid_counts) / len(valid_counts), 2) if valid_counts else None
        ),
    }


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate the live Gemini DesignPlan contract")
    parser.add_argument("--confirm-live", action="store_true", help="acknowledge paid API calls")
    parser.add_argument("--model", action="append", dest="models")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--limit", type=int, default=None)
    return parser.parse_args()


async def _main() -> None:
    args = _arguments()
    if not args.confirm_live:
        raise SystemExit("Refusing live provider calls without --confirm-live")
    project = os.environ.get("GCP_PROJECT_ID", "")
    if not project:
        raise SystemExit("GCP_PROJECT_ID is required")
    prompts = json.loads(args.corpus.read_text(encoding="utf-8"))
    if not isinstance(prompts, list) or not all(isinstance(item, str) for item in prompts):
        raise SystemExit("corpus must be a JSON string array")
    if args.limit is not None:
        if args.limit < 1:
            raise SystemExit("--limit must be positive")
        prompts = prompts[: args.limit]
    models = list(dict.fromkeys(args.models or [DEFAULT_MODEL]))
    results = [await _evaluate_model(model, prompts, project) for model in models]
    print(json.dumps({"corpus_size": len(prompts), "results": results}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(_main())
