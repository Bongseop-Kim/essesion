"""Offline semantic scoring. No database or provider calls; see docs/api-spec/design-evaluation.md."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from worker.engine.compose import compose_design
from worker.engine.placement import place
from worker.engine.primitives import build_primitive
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
            if case.before is not None and case.before not in self.fixtures:
                raise ValueError(f"unknown fixture: {case.before}")
            if case.mode != "initial" and case.before is None:
                raise ValueError("edit/reject needs a baseline")
            if any(check.op != "eq" for check in case.checks) and case.before is None:
                raise ValueError("relative checks need a baseline")
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
    return {
        key: MotifDef(id=key, symbol=value)
        for key, value in corpus.motifs.items()
    }


def facts(observation: Observation, corpus: Corpus) -> dict[str, Any]:
    if observation.rejection is not None:
        return {"rejection": observation.rejection}
    assert observation.intent is not None
    # Score the same repaired intent and selected colorway that compose actually renders.
    design = compose_design(
        observation.intent, seed=observation.seed,
        colorway=observation.colorway_id, motifs=catalog(corpus),
    )
    intent = design.intent
    palette = build_palette(intent)
    tile = intent.canvas.tile_mm
    hosts = {
        layer.id: build_primitive(layer, tile)
        for layer in intent.layers if layer.type in ("background", "stripe")
    }
    out: dict[str, Any] = {"tile_mm": tile}
    backgrounds = [layer for layer in intent.layers if layer.type == "background"]
    if len(backgrounds) == 1 and backgrounds[0].opacity == 1:
        out["background.color"] = palette.resolve_color(
            backgrounds[0].params.color, design.colorway_id,
        ).upper()
    stripes = [layer for layer in intent.layers if layer.type == "stripe"]
    out["stripe.count"] = len(stripes)
    if len(stripes) == 1:
        stripe = stripes[0]
        out["stripe.colors"] = [
            palette.resolve_color(band.color, design.colorway_id).upper()
            for band in stripe.params.bands
        ]
        out["stripe.angle"] = stripe.params.angle
        out["stripe.geometry"] = stripe.params.model_dump(exclude={"bands"}) | {
            "bands": [(band.offset_mm, band.width_mm) for band in stripe.params.bands],
        }
    motifs = [layer for layer in intent.layers if layer.type == "motif"]
    out["motif.ids"] = sorted(layer.params.motif_id for layer in motifs)
    for layer in motifs:
        key = f"motif.{layer.params.motif_id}"
        if out["motif.ids"].count(layer.params.motif_id) != 1:
            raise ValueError("ambiguous motif identity in evaluation")
        placement = layer.placement
        assert placement is not None
        positions = place(layer, hosts.get(placement.host_layer), tile, intent.seed)
        points = sorted((point.x_mm, point.y_mm, point.rotation_deg) for point in positions)
        out.update({
            f"{key}.size_mm": layer.params.size_mm,
            f"{key}.placement": placement.type,
            f"{key}.positions": points,
            f"{key}.rotation": sorted({point.rotation_deg % 360 for point in positions}),
            f"{key}.count": len(positions),
            f"{key}.density": len(positions) / tile**2,
            f"{key}.appearance": {
                "size": layer.params.size_mm, "positions": points,
                "opacity": layer.opacity, "z_order": layer.z_order,
            },
        })
        if placement.lattice is not None:
            out[f"{key}.drop"] = placement.lattice.drop_fraction or 0
        if placement.scatter is not None and placement.scatter.count is not None:
            out[f"{key}.count_fulfilled"] = len(positions) == placement.scatter.count
        if placement.host_layer is not None and placement.lane is not None:
            out[f"{key}.lane"] = placement.lane
    return out


def equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, int | float) and isinstance(right, int | float):
        return math.isclose(left, right, rel_tol=1e-6, abs_tol=1e-6)
    if isinstance(left, list | tuple) and isinstance(right, list | tuple):
        return len(left) == len(right) and all(equal(a, b) for a, b in zip(left, right))
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
    by_id = {item.case_id: item for item in observations}
    if len(by_id) != len(observations) or set(by_id) - {case.id for case in corpus.cases}:
        raise ValueError("duplicate or unknown observation ID")
    rows = []
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for case in corpus.cases:
        before = facts(Observation(case_id=case.id, intent=corpus.fixtures[case.before]), corpus) \
            if case.before else {}
        error = None
        actual: dict[str, Any] = {}
        if case.id not in by_id:
            error = "missing_output"
        else:
            try:
                actual = facts(by_id[case.id], corpus)
            except (ValueError, AssertionError, KeyError) as exc:
                error = type(exc).__name__
            except Exception as exc:
                # Invalid engine input is a failed observation, never a smaller denominator.
                error = type(exc).__name__
        checks = [error is None and passes(check, actual, before) for check in case.checks]
        for check, passed in zip(case.checks, checks):
            total = totals[f"{check.fact}:{check.op}"]
            total[0] += int(passed)
            total[1] += 1
        rows.append({
            "id": case.id, "mode": case.mode, "split": case.split,
            "passed": all(checks), "error": error,
            "failed_checks": [i for i, passed in enumerate(checks) if not passed],
        })
    return {
        "corpus_revision": corpus.revision, "review_status": corpus.review_status,
        "total": len(rows), "passed": sum(row["passed"] for row in rows),
        "by_condition": {key: {"passed": val[0], "total": val[1]} for key, val in totals.items()},
        "cases": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--outputs", type=Path, required=True)
    args = parser.parse_args()
    corpus = Corpus.model_validate_json(args.corpus.read_text())
    observations = [Observation.model_validate(item) for item in json.loads(args.outputs.read_text())]
    report = evaluate(corpus, observations)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["passed"] == report["total"] else 1)


if __name__ == "__main__":
    main()
