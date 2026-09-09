"""Offline semantic scoring. See docs/api-spec/design-evaluation.md; no provider or DB calls."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from worker.engine.compose import compose_design
from worker.engine.constraints import normalize_hex
from worker.engine.determinism import ENGINE_VERSION
from worker.engine.placement import place
from worker.engine.primitives import Stripe, build_primitive
from worker.engine.validate import build_palette
from worker.motifs.registry import MotifDef

DEFAULT_CORPUS = Path(__file__).with_name("design_accuracy_cases.json")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Check(StrictModel):
    fact: str
    op: Literal["eq", "unchanged", "lt_before", "gt_before"] = "eq"
    value: Any = None

    @model_validator(mode="after")
    def valid_operand(self) -> Check:
        if self.op == "eq" and self.value is None:
            raise ValueError("eq requires a non-null value")
        if self.op != "eq" and self.value is not None:
            raise ValueError("relative checks use the baseline, not value")
        return self


class Case(StrictModel):
    id: str
    split: Literal["regression", "held_out"]
    mode: Literal["initial", "edit", "reject"]
    prompt: str = Field(min_length=1)
    # Exact fixture symbols are supplied in this order; no live catalog search is scored.
    input_motif_ids: list[str] = Field(default_factory=list)
    before: str | None = None
    checks: list[Check] = Field(min_length=1)


class Corpus(StrictModel):
    revision: str
    review_status: Literal["draft", "reviewed"]
    motifs: dict[str, str]
    fixtures: dict[str, dict[str, Any]]
    cases: list[Case] = Field(min_length=1)

    @model_validator(mode="after")
    def valid_cases(self) -> Corpus:
        if len({case.id for case in self.cases}) != len(self.cases):
            raise ValueError("duplicate case ID")
        for case in self.cases:
            if len(set(case.input_motif_ids)) != len(case.input_motif_ids):
                raise ValueError("duplicate input motif")
            if set(case.input_motif_ids) - self.motifs.keys():
                raise ValueError("unknown input motif")
            if case.before is not None and case.before not in self.fixtures:
                raise ValueError(f"unknown fixture: {case.before}")
            if case.mode != "initial" and case.before is None:
                raise ValueError("edit/reject needs a baseline")
            if any(check.op != "eq" for check in case.checks) and case.before is None:
                raise ValueError("relative checks need a baseline")
            if case.mode == "reject" and not any(c.fact == "rejection" for c in case.checks):
                raise ValueError("reject case must specify a rejection condition")
        return self


class Observation(StrictModel):
    case_id: str
    intent: dict[str, Any] | None = None
    rejection: str | None = None
    colorway_id: str | None = None
    seed: int | None = None

    @model_validator(mode="after")
    def exactly_one_result(self) -> Observation:
        if (self.intent is None) == (self.rejection is None):
            raise ValueError("provide exactly one of intent or rejection")
        return self


def catalog(corpus: Corpus) -> dict[str, MotifDef]:
    return {key: MotifDef(id=key, symbol=value) for key, value in corpus.motifs.items()}


def facts(observation: Observation, corpus: Corpus) -> dict[str, Any]:
    if observation.rejection is not None:
        return {"rejection": observation.rejection}
    assert observation.intent is not None
    # Score the same repaired intent and selected colorway that compose actually renders.
    design = compose_design(
        observation.intent,
        seed=observation.seed,
        colorway=observation.colorway_id,
        motifs=catalog(corpus),
    )
    intent = design.intent
    palette = build_palette(intent)
    tile = intent.canvas.tile_mm
    hosts = {
        layer.id: build_primitive(layer, tile)
        for layer in intent.layers
        if layer.type in ("background", "stripe")
    }
    out: dict[str, Any] = {"tile_mm": tile}
    backgrounds = [layer for layer in intent.layers if layer.type == "background"]
    if len(backgrounds) == 1 and backgrounds[0].opacity == 1:
        out["background.color"] = normalize_hex(
            palette.resolve_color(
                backgrounds[0].params.color,
                design.colorway_id,
            )
        )
    stripes = [layer for layer in intent.layers if layer.type == "stripe" and layer.opacity > 0]
    out["stripe.count"] = len(stripes)
    if len(stripes) == 1:
        stripe = stripes[0]
        if stripe.opacity == 1:
            out["stripe.colors"] = [
                normalize_hex(palette.resolve_color(band.color, design.colorway_id))
                for band in stripe.params.bands
            ]
        out["stripe.angle"] = stripe.params.angle
        out["stripe.geometry"] = stripe.params.model_dump(exclude={"bands"}) | {
            "bands": [(band.offset_mm, band.width_mm) for band in stripe.params.bands],
        }
    motifs = sorted(
        (layer for layer in intent.layers if layer.type == "motif" and layer.opacity > 0),
        key=lambda layer: (layer.z_order, layer.id),
    )
    out["motif.ids"] = sorted(layer.params.motif_id for layer in motifs)
    for draw_order, layer in enumerate(motifs):
        key = f"motif.{layer.params.motif_id}"
        if out["motif.ids"].count(layer.params.motif_id) != 1:
            raise ValueError("ambiguous motif identity in evaluation")
        placement = layer.placement
        assert placement is not None
        host = hosts.get(placement.host_layer) if placement.host_layer is not None else None
        if host is not None and not isinstance(host, Stripe):
            raise ValueError("motif host must be a stripe")
        positions = place(layer, host, tile, intent.seed)
        points = sorted((point.x_mm, point.y_mm, point.rotation_deg) for point in positions)
        out.update(
            {
                f"{key}.size_mm": layer.params.size_mm,
                f"{key}.placement": placement.type,
                f"{key}.positions": points,
                f"{key}.centers": sorted((point.x_mm, point.y_mm) for point in positions),
                f"{key}.normalized_positions": sorted(
                    (point.x_mm / tile, point.y_mm / tile, point.rotation_deg)
                    for point in positions
                ),
                f"{key}.relative_size": layer.params.size_mm / tile,
                f"{key}.rotation": sorted({point.rotation_deg % 360 for point in positions}),
                f"{key}.count": len(positions),
                f"{key}.density": len(positions) / tile**2,
                f"{key}.appearance": {
                    "size": layer.params.size_mm,
                    "positions": points,
                    "opacity": layer.opacity,
                    "draw_order": draw_order,
                },
            }
        )
        if placement.lattice is not None:
            out[f"{key}.drop"] = placement.lattice.drop_fraction or 0
        if placement.scatter is not None and placement.scatter.count is not None:
            out[f"{key}.count_fulfilled"] = len(positions) == placement.scatter.count
        if placement.host_layer is not None and placement.lane is not None:
            out[f"{key}.lane"] = placement.lane
            # Lane labels alone are not enough: ensure the host is a real stripe.
            out[f"{key}.stripe_host"] = any(stripe.id == placement.host_layer for stripe in stripes)
    return out


def equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, int | float) and isinstance(right, int | float):
        return math.isclose(left, right, rel_tol=1e-6, abs_tol=1e-6)
    if isinstance(left, list | tuple) and isinstance(right, list | tuple):
        return len(left) == len(right) and all(
            equal(a, b) for a, b in zip(left, right, strict=True)
        )
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(equal(left[k], right[k]) for k in left)
    return left == right


def passes(check: Check, actual: dict[str, Any], before: dict[str, Any]) -> bool:
    if check.fact not in actual:
        return False  # Missing subjects never pass dependent conditions.
    value = actual[check.fact]
    if check.op == "eq":
        return equal(value, check.value)
    if check.fact not in before:
        return False
    previous = before[check.fact]
    if check.op == "unchanged":
        return equal(value, previous)
    if not all(type(item) in (int, float) for item in (value, previous)):
        return False
    if equal(value, previous):
        return False
    return value < previous if check.op == "lt_before" else value > previous


def evaluate(corpus: Corpus, observations: list[Observation]) -> dict[str, Any]:
    validate_corpus(corpus)
    by_id = {item.case_id: item for item in observations}
    if len(by_id) != len(observations) or set(by_id) - {case.id for case in corpus.cases}:
        raise ValueError("duplicate or unknown observation ID")
    rows = []
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for case in corpus.cases:
        before = (
            facts(Observation(case_id=case.id, intent=corpus.fixtures[case.before]), corpus)
            if case.before
            else {}
        )
        error = None
        actual: dict[str, Any] = {}
        if case.id not in by_id:
            error = "missing_output"
        else:
            try:
                actual = facts(by_id[case.id], corpus)
            except Exception as exc:
                # Invalid engine input is a failed observation, never a smaller denominator.
                error = type(exc).__name__
        checks = [error is None and passes(check, actual, before) for check in case.checks]
        for check, passed in zip(case.checks, checks, strict=True):
            total = totals[f"{check.fact}:{check.op}"]
            total[0] += int(passed)
            total[1] += 1
        rows.append(
            {
                "id": case.id,
                "mode": case.mode,
                "split": case.split,
                "passed": all(checks),
                "error": error,
                "failed_checks": [i for i, passed in enumerate(checks) if not passed],
            }
        )
    passed_cases = sum(row["passed"] for row in rows)
    total_checks = sum(value[1] for value in totals.values())
    passed_checks = sum(value[0] for value in totals.values())
    return {
        "corpus_revision": corpus.revision,
        "review_status": corpus.review_status,
        "scorer_revision": "design-accuracy-v1",
        "engine_version": ENGINE_VERSION,
        "corpus_sha256": hashlib.sha256(corpus.model_dump_json().encode()).hexdigest(),
        "total": len(rows),
        "passed": passed_cases,
        "all_conditions_pass_rate": passed_cases / len(rows),
        "conditions": {"passed": passed_checks, "total": total_checks},
        "unexpected_rejections": sum(
            case.mode != "reject" and case.id in by_id and by_id[case.id].rejection is not None
            for case in corpus.cases
        ),
        "by_mode": {
            mode: {
                "passed": sum(row["passed"] for row in rows if row["mode"] == mode),
                "total": sum(row["mode"] == mode for row in rows),
            }
            for mode in ("initial", "edit", "reject")
        },
        "by_split": {
            split: {
                "passed": sum(row["passed"] for row in rows if row["split"] == split),
                "total": sum(row["split"] == split for row in rows),
            }
            for split in ("regression", "held_out")
        },
        "by_condition": {key: {"passed": val[0], "total": val[1]} for key, val in totals.items()},
        "cases": rows,
    }


def validate_corpus(corpus: Corpus) -> None:
    samples = {
        key: facts(Observation(case_id=key, intent=value), corpus)
        for key, value in corpus.fixtures.items()
    }
    available = {
        "rejection",
        "background.color",
        "tile_mm",
        "stripe.count",
        "stripe.colors",
        "stripe.angle",
        "stripe.geometry",
        "motif.ids",
    }
    for motif_id in corpus.motifs:
        available.update(
            f"motif.{motif_id}.{suffix}"
            for suffix in (
                "size_mm",
                "placement",
                "positions",
                "centers",
                "normalized_positions",
                "relative_size",
                "rotation",
                "count",
                "density",
                "appearance",
                "drop",
                "count_fulfilled",
                "lane",
                "stripe_host",
            )
        )
    for case in corpus.cases:
        for check in case.checks:
            if check.fact not in available:
                raise ValueError(f"unknown fact in {case.id}: {check.fact}")
            if check.op != "eq":
                assert case.before is not None
                if check.fact not in samples[case.before]:
                    raise ValueError(f"missing baseline fact in {case.id}: {check.fact}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--outputs", type=Path)
    mode.add_argument("--check-corpus", action="store_true")
    args = parser.parse_args()
    corpus = Corpus.model_validate_json(args.corpus.read_text())
    validate_corpus(corpus)
    if args.check_corpus:
        print(
            json.dumps(
                {
                    "cases": len(corpus.cases),
                    "corpus_valid": True,
                    "review_status": corpus.review_status,
                    "model_evaluated": False,
                }
            )
        )
        return
    observations = [
        Observation.model_validate(item) for item in json.loads(args.outputs.read_text())
    ]
    report = evaluate(corpus, observations)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["passed"] == report["total"] else 1)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Validation errors can include input JSON; keep provider/user content out of diagnostics.
        print(f"Evaluation failed: {type(exc).__name__}", file=sys.stderr)
        raise SystemExit(2) from None
