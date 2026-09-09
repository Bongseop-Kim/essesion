"""Offline semantic scoring. See docs/api-spec/design-evaluation.md; no provider or DB calls."""

from __future__ import annotations

import argparse
import hashlib
import io
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
from worker.engine.placement import Instance, place
from worker.engine.primitives import Stripe, band_gaps, build_primitive
from worker.engine.seamless import clone_instances, rendered_aabb
from worker.engine.validate import build_palette
from worker.motifs.registry import MotifDef

DEFAULT_CORPUS = Path(__file__).with_name("design_accuracy_cases.json")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


# eq/lte/gte compare against `value`; the rest compare against the same fixture's baseline.
_ABSOLUTE_OPS = ("eq", "lte", "gte")


class Check(StrictModel):
    fact: str
    op: Literal["eq", "lte", "gte", "unchanged", "lt_before", "gt_before"] = "eq"
    value: Any = None

    @model_validator(mode="after")
    def valid_operand(self) -> Check:
        if self.op in _ABSOLUTE_OPS and self.value is None:
            raise ValueError(f"{self.op} requires a non-null value")
        if self.op not in _ABSOLUTE_OPS and self.value is not None:
            raise ValueError("relative checks use the baseline, not value")
        if self.op in ("lte", "gte") and not isinstance(self.value, int | float):
            raise ValueError(f"{self.op} requires a numeric bound")
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
            if any(check.op not in _ABSOLUTE_OPS for check in case.checks) and case.before is None:
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


Box = tuple[float, float, float, float]
# 알파 마스크 2단계 판정의 고정 조건 — 해상도·임계값을 바꾸면 결과가 바뀐다.
MASK_PX_PER_MM = 8
MASK_ALPHA_THRESHOLD = 16


def _overlaps(a: Box, b: Box) -> bool:
    """Rotated-AABB overlap. An overestimate for thin or curved shapes, never an underestimate:
    a positive count is a candidate pair, a zero is a real non-overlap proof."""
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _pair_overlaps(boxes: list[Box], others: list[Box] | None = None) -> int:
    # ponytail: O(n^2) over one tile's instances (max_placement_instances bounded); an offline
    # scorer, not a render path. Grid-bucket it if a corpus ever needs thousands of instances.
    if others is None:
        return sum(
            _overlaps(a, b) for index, a in enumerate(boxes) for b in boxes[index + 1 :]
        )
    return sum(_overlaps(a, b) for a in boxes for b in others)


def _instance_mask(motif: MotifDef, size_mm: float, rotation_deg: float):
    """인스턴스 하나를 자기 AABB에 꽉 맞춰 렌더한 알파 마스크 (PIL, 렌더러 필요)."""
    from PIL import Image  # noqa: PLC0415 - renderer-only path
    from worker.engine.composition import _instance_transform, render_svg_document
    from worker.render.raster import rasterize_svg

    inst = Instance(0.0, 0.0, rotation_deg)
    min_x, min_y, max_x, max_y = rendered_aabb(motif, inst, size_mm)
    width, height = max_x - min_x, max_y - min_y
    transform = _instance_transform(motif, inst, size_mm)
    body = (
        f'<g transform="translate({-min_x} {-min_y})">'
        f'<use href="#motif-{motif.id}" transform="{transform}"/></g>'
    )
    document = render_svg_document(body, width, height, defs=motif.symbol)
    png, _ = rasterize_svg(
        document, width_mm=width, height_mm=height, dpi=round(MASK_PX_PER_MM * 25.4)
    )
    alpha = Image.open(io.BytesIO(png)).convert("RGBA").getchannel("A")
    table = [255 if value > MASK_ALPHA_THRESHOLD else 0 for value in range(256)]
    return alpha.point(table)


def _paste(image_module, mask, box: Box, left: float, top: float, width: int, height: int):
    canvas = image_module.new("L", (width, height), 0)
    canvas.paste(
        mask,
        (
            round((box[0] - left) * MASK_PX_PER_MM),
            round((box[1] - top) * MASK_PX_PER_MM),
        ),
    )
    return canvas


def _ink_overlaps(candidates: list[tuple[Box, Any]]) -> int:
    """AABB가 겹친 쌍만 마스크로 재판정한다 — 겹친 잉크가 한 픽셀이라도 있으면 1.

    저해상도 마스크라 비겹침의 수학적 증명이 아니다(가는 선은 놓칠 수 있다).
    """
    from PIL import Image, ImageChops  # noqa: PLC0415 - renderer-only path

    hits = 0
    for index, (box_a, mask_a) in enumerate(candidates):
        for box_b, mask_b in candidates[index + 1 :]:
            if not _overlaps(box_a, box_b):
                continue
            left = min(box_a[0], box_b[0])
            top = min(box_a[1], box_b[1])
            width = max(1, round((max(box_a[2], box_b[2]) - left) * MASK_PX_PER_MM))
            height = max(1, round((max(box_a[3], box_b[3]) - top) * MASK_PX_PER_MM))
            canvas_a = _paste(Image, mask_a, box_a, left, top, width, height)
            canvas_b = _paste(Image, mask_b, box_b, left, top, width, height)
            if ImageChops.multiply(canvas_a, canvas_b).getbbox():
                hits += 1
    return hits


def _lane_band(stripe: Stripe, lane: str) -> tuple[float, float] | None:
    """(low, high) normal-direction span the lane points at: the band for `center`, the empty
    space for `gap`. Edge lanes (`start`/`end`) name a line, not an area, so they score nothing."""
    bands = stripe.params.bands
    name = lane.rsplit(".", 1)[-1]
    index = 0
    if lane.startswith("b") and "." in lane:
        try:
            index = int(lane[1 : lane.index(".")])
        except ValueError:
            return None
    if index >= len(bands):
        return None
    band = bands[index]
    if name == "center":
        return (band.offset_mm, band.offset_mm + band.width_mm)
    if name == "gap":
        gaps = band_gaps(
            [(item.offset_mm, item.width_mm) for item in bands], stripe.params.period_mm
        )
        low, high = gaps[index]
        return (low, high) if high > low else None
    return None


def _shape_inside_lane(
    stripe: Stripe, lane: str, motif: MotifDef, instances: list[Instance], size_mm: float
) -> bool | None:
    """Whether every whole rotated shape fits inside its lane's band, not just its center."""
    span = _lane_band(stripe, lane)
    if span is None:
        return None
    low, high = span
    period = stripe.params.period_mm
    angle = math.radians(stripe.snapped.angle_deg)
    nx, ny = -math.sin(angle), math.cos(angle)
    for inst in instances:
        min_x, min_y, max_x, max_y = rendered_aabb(motif, inst, size_mm)
        projections = [
            x * nx + y * ny for x in (min_x, max_x) for y in (min_y, max_y)
        ]
        near, far = min(projections), max(projections)
        # Bands repeat every period; slide the span to the copy that starts just below `near`.
        shift = math.floor((near - low) / period) * period
        if not (near >= low + shift - 1e-9 and far <= high + shift + 1e-9):
            return False
    return True


def facts(observation: Observation, corpus: Corpus, *, ink: bool = False) -> dict[str, Any]:
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
    boxes_by_layer: dict[str, list[Box]] = {}
    ink_by_layer: dict[str, list[tuple[Box, Any]]] = {}
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
        # Whole-shape geometry: boundary clones included, so a neighbour across the tile edge
        # counts the same as one inside it.
        motif = MotifDef(id=layer.params.motif_id, symbol=corpus.motifs[layer.params.motif_id])
        cloned = clone_instances(
            positions, motif=motif, size_mm=layer.params.size_mm, tile_mm=tile
        )
        boxes = [rendered_aabb(motif, inst, layer.params.size_mm) for inst in cloned]
        boxes_by_layer[key] = boxes
        out[f"{key}.self_overlaps"] = _pair_overlaps(boxes)
        if ink:
            # 회전이 인스턴스마다 다르면 마스크도 그만큼 렌더한다(고정 회전이면 1회).
            masks = {
                inst.rotation_deg: _instance_mask(motif, layer.params.size_mm, inst.rotation_deg)
                for inst in cloned
            }
            candidates = [
                (box, masks[inst.rotation_deg])
                for box, inst in zip(boxes, cloned, strict=True)
            ]
            ink_by_layer[key] = candidates
            out[f"{key}.self_ink_overlaps"] = _ink_overlaps(candidates)
        if placement.host_layer is not None and placement.lane is not None:
            out[f"{key}.lane"] = placement.lane
            # Lane labels alone are not enough: ensure the host is a real stripe.
            out[f"{key}.stripe_host"] = any(stripe.id == placement.host_layer for stripe in stripes)
            if isinstance(host, Stripe):
                inside = _shape_inside_lane(
                    host, placement.lane, motif, cloned, layer.params.size_mm
                )
                if inside is not None:
                    out[f"{key}.lane_contains_shape"] = inside
    keys = sorted(boxes_by_layer)
    out["motif.overlaps"] = sum(
        _pair_overlaps(boxes_by_layer[left], boxes_by_layer[right])
        for index, left in enumerate(keys)
        for right in keys[index + 1 :]
    ) + sum(out[f"{key}.self_overlaps"] for key in keys)
    if ink:
        out["motif.ink_overlaps"] = _ink_overlaps(
            [item for key in keys for item in ink_by_layer.get(key, [])]
        )
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
    if check.op in ("lte", "gte"):
        if isinstance(value, bool) or not isinstance(value, int | float):
            return False
        bound = float(check.value)
        # Bounds are inclusive within the same tolerance the equality path uses.
        if equal(value, bound):
            return True
        return value < bound if check.op == "lte" else value > bound
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


def evaluate(
    corpus: Corpus, observations: list[Observation], *, ink: bool = False
) -> dict[str, Any]:
    validate_corpus(corpus, ink=ink)
    by_id = {item.case_id: item for item in observations}
    if len(by_id) != len(observations) or set(by_id) - {case.id for case in corpus.cases}:
        raise ValueError("duplicate or unknown observation ID")
    rows = []
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for case in corpus.cases:
        before = (
            facts(
                Observation(case_id=case.id, intent=corpus.fixtures[case.before]), corpus, ink=ink
            )
            if case.before
            else {}
        )
        error = None
        actual: dict[str, Any] = {}
        if case.id not in by_id:
            error = "missing_output"
        else:
            try:
                actual = facts(by_id[case.id], corpus, ink=ink)
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
        "ink_overlap_stage": ink,
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


def validate_corpus(corpus: Corpus, *, ink: bool = False) -> None:
    samples = {
        key: facts(Observation(case_id=key, intent=value), corpus, ink=ink)
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
        "motif.overlaps",
        "motif.ink_overlaps",
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
                "self_overlaps",
                "self_ink_overlaps",
                "lane_contains_shape",
            )
        )
    for case in corpus.cases:
        for check in case.checks:
            if check.fact not in available:
                raise ValueError(f"unknown fact in {case.id}: {check.fact}")
            if check.op not in _ABSOLUTE_OPS:
                assert case.before is not None
                if check.fact not in samples[case.before]:
                    raise ValueError(f"missing baseline fact in {case.id}: {check.fact}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--outputs", type=Path)
    mode.add_argument("--check-corpus", action="store_true")
    # 알파 마스크 2단계 — 렌더러(rsvg-convert/resvg)가 필요하고 AABB 오탐을 걸러낸다.
    parser.add_argument("--ink-overlap", action="store_true")
    args = parser.parse_args()
    corpus = Corpus.model_validate_json(args.corpus.read_text())
    validate_corpus(corpus, ink=args.ink_overlap)
    if args.check_corpus:
        print(
            json.dumps(
                {
                    "cases": len(corpus.cases),
                    "corpus_valid": True,
                    "review_status": corpus.review_status,
                    "ink_overlap_stage": args.ink_overlap,
                    "model_evaluated": False,
                }
            )
        )
        return
    observations = [
        Observation.model_validate(item) for item in json.loads(args.outputs.read_text())
    ]
    report = evaluate(corpus, observations, ink=args.ink_overlap)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["passed"] == report["total"] else 1)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Validation errors can include input JSON; keep provider/user content out of diagnostics.
        print(f"Evaluation failed: {type(exc).__name__}", file=sys.stderr)
        raise SystemExit(2) from None
