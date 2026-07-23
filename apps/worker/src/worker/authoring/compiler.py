"""Deterministic DesignPlan v3 → engine Intent compiler."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from worker.authoring.schema import (
    DesignPlanV3,
    PathDirection,
    PathPlacementPlan,
    PlacementPlan,
    StripeLayerPlan,
    structural_fingerprint,
)
from worker.engine.constraints import PaletteConstraint
from worker.engine.units import snap_angle

DEFAULT_TILE_MM = 48.0
DEFAULT_DPI = 300
PLAN_CONTRACT_VERSION = 3
COMPILER_REVISION = "design-plan-v3.0"

_DIRECTION_ANGLE: dict[PathDirection, float] = {
    "horizontal": 0.0,
    "vertical": 90.0,
    "diagonal_up": -45.0,
    "diagonal_down": 45.0,
    "diagonal_2_3_up": -33.690067525979785,
    "diagonal_2_3_down": 33.690067525979785,
}


@dataclass(frozen=True)
class AuthoredDesign:
    """Engine intent plus authoring-only sidecars consumed before final validation."""

    intent: dict
    motif_specs: list[dict] = field(default_factory=list)
    motif_resolutions: list[dict[str, object]] = field(default_factory=list)
    motif_color_slots: dict[str, list[str]] = field(default_factory=dict)
    plan: dict | None = None
    structural_fingerprint: str | None = None


class PlanCompileError(ValueError):
    def __init__(self, message: str, *, grounding: bool = False) -> None:
        super().__init__(message)
        self.grounding = grounding


@dataclass(frozen=True)
class _ResolvedMotifSource:
    motif_id: str
    spec: dict | None = None
    resolution: dict[str, object] | None = None


def _resolve_motif_sources(
    plan: DesignPlanV3,
    *,
    motif_ids: list[str],
    catalog_candidates: list[dict[str, object]],
    reference_motif_indexes: set[int],
    reference_image_count: int,
) -> list[_ResolvedMotifSource]:
    candidate_by_ref = {
        str(candidate["catalog_ref"]): candidate for candidate in catalog_candidates
    }
    sources: list[_ResolvedMotifSource] = []
    input_indexes: set[int] = set()
    input_count = 0
    reference_counts: dict[int, int] = {}
    catalog_refs: set[str] = set()
    catalog_count = 0

    for source in plan.motifs:
        if source.source == "input":
            input_count += 1
            if source.input_index > len(motif_ids):
                raise PlanCompileError(f"unknown exact motif input: {source.input_index}")
            input_indexes.add(source.input_index)
            motif_id = motif_ids[source.input_index - 1]
            sources.append(
                _ResolvedMotifSource(
                    motif_id=motif_id,
                    resolution={
                        "outcome": "user_exact",
                        "motif_id": motif_id,
                        "similarity": None,
                    },
                )
            )
        elif source.source == "catalog":
            catalog_count += 1
            if motif_ids:
                raise PlanCompileError("catalog motifs cannot be combined with exact motifs")
            if source.catalog_ref in catalog_refs:
                raise PlanCompileError(
                    f"catalog_ref must be declared at most once: {source.catalog_ref}",
                    grounding=True,
                )
            catalog_refs.add(source.catalog_ref)
            candidate = candidate_by_ref.get(source.catalog_ref)
            if candidate is None:
                raise PlanCompileError(f"unknown catalog_ref: {source.catalog_ref}", grounding=True)
            motif_id = str(candidate["motif_id"])
            sources.append(
                _ResolvedMotifSource(
                    motif_id=motif_id,
                    resolution={
                        "outcome": "prompt_catalog",
                        "motif_id": motif_id,
                        "subject": candidate.get("subject"),
                        "similarity": candidate.get("similarity"),
                        "match_type": candidate.get("match_type"),
                    },
                )
            )
        else:
            if source.reference_image_index > reference_image_count:
                raise PlanCompileError(f"unknown reference image: {source.reference_image_index}")
            reference_counts[source.reference_image_index] = (
                reference_counts.get(source.reference_image_index, 0) + 1
            )
            sources.append(
                _ResolvedMotifSource(
                    motif_id=f"semantic_{len(sources)}",
                    spec={
                        "subject": source.subject,
                        "scope": source.scope,
                        "style": source.style,
                        "description": source.description,
                        "reference_image_index": source.reference_image_index,
                        "required": source.reference_image_index in reference_motif_indexes,
                    },
                )
            )

    required_inputs = set(range(1, len(motif_ids) + 1))
    if input_indexes != required_inputs or input_count != len(required_inputs):
        raise PlanCompileError("every exact motif input must be represented exactly once")
    if any(reference_counts.get(index, 0) != 1 for index in reference_motif_indexes):
        raise PlanCompileError("every motif reference photo must be represented exactly once")
    if (
        plan.motifs
        and catalog_candidates
        and not motif_ids
        and len(reference_counts) < 2
        and catalog_count == 0
    ):
        raise PlanCompileError(
            "a verified catalog_ref is required while a motif slot remains", grounding=True
        )
    return sources


def _slot_ids(plan: DesignPlanV3) -> list[str]:
    return [
        "ground" if index == plan.ground_color_index else f"color_{index}"
        for index in range(len(plan.colors))
    ]


def _path_length(tile_mm: float, direction: PathDirection) -> float:
    snapped = snap_angle(_DIRECTION_ANGLE[direction])
    return tile_mm * math.hypot(snapped.p, snapped.q)


def _compile_placement(
    placement: PlacementPlan,
    *,
    tile_mm: float,
    stripes: list[StripeLayerPlan],
) -> dict[str, object]:
    if placement.type == "lattice":
        lattice: dict[str, object] = {
            "cell_w_mm": round(tile_mm / placement.columns, 6),
            "cell_h_mm": round(tile_mm / placement.rows, 6),
        }
        if placement.drop != "none":
            lattice.update(
                {
                    "drop_fraction": 0.5,
                    "drop_axis": "row" if placement.drop == "half_row" else "column",
                }
            )
        return {
            "type": "lattice",
            "fixed_rotation_deg": placement.fixed_rotation_deg,
            "lattice": lattice,
        }

    if placement.type == "scatter":
        scatter: dict[str, object] = {"mode": placement.mode}
        if placement.mode == "poisson":
            scatter.update(
                {
                    "min_dist_mm": round(tile_mm * placement.min_distance_ratio, 6),
                    "count": placement.count,
                }
            )
        else:
            scatter.update({"sateen_n": placement.order, "sateen_step": placement.step})
        return {
            "type": "scatter",
            "fixed_rotation_deg": placement.fixed_rotation_deg,
            "scatter": scatter,
        }

    if placement.type == "point_template":
        points_by_template = {
            "quincunx_inset": [
                (0.20710625, 0.20710625),
                (0.79289375, 0.20710625),
                (0.20710625, 0.79289375),
                (0.79289375, 0.79289375),
                (0.5, 0.5),
            ],
            "diagonal_pair": [(0.25, 0.25), (0.75, 0.75)],
            "grid4_inset": [
                ((column + 0.5) / 4, (row + 0.5) / 4) for row in range(4) for column in range(4)
            ],
        }
        return {
            "type": "point_set",
            "fixed_rotation_deg": placement.fixed_rotation_deg,
            "point_set": {
                "points": [
                    [round(x * tile_mm, 6), round(y * tile_mm, 6)]
                    for x, y in points_by_template[placement.template]
                ]
            },
        }

    return _compile_path(placement, tile_mm=tile_mm, stripes=stripes)


def _compile_path(
    placement: PathPlacementPlan,
    *,
    tile_mm: float,
    stripes: list[StripeLayerPlan],
) -> dict[str, object]:
    direction = placement.direction
    output: dict[str, object] = {
        "type": "path_following",
        "rotation": placement.rotation,
    }
    if placement.rotation == "fixed":
        output["fixed_rotation_deg"] = placement.fixed_rotation_deg

    # Only StraightPathPlan carries host fields; WavePathPlan has none (wave is never hosted).
    host_index = getattr(placement, "host_stripe_index", None)
    if host_index is not None:
        direction = stripes[host_index].direction
        output["host_layer"] = f"stripe_{host_index}"
        host_band_index = getattr(placement, "host_band_index", None)
        output["lane"] = "center" if host_band_index is None else f"b{host_band_index}.center"
    else:
        path: dict[str, object] = {
            "kind": placement.kind,
            "angle": _DIRECTION_ANGLE[placement.direction],
        }
        if placement.kind == "wave":
            path.update(
                {
                    "wavelength": round(tile_mm * placement.wavelength_ratio, 6),
                    "amplitude": round(tile_mm * placement.amplitude_ratio, 6),
                }
            )
        output["path"] = path

    length = _path_length(tile_mm, direction)
    output["spacing_mm"] = round(length * placement.spacing_ratio, 6)
    output["phase_mm"] = round(length * placement.phase_ratio, 6)
    return output


def compile_design_plan_v3(
    plan: DesignPlanV3,
    *,
    plan_index: int,
    motif_ids: list[str] | None = None,
    catalog_candidates: list[dict[str, object]] | None = None,
    reference_motif_indexes: set[int] | None = None,
    reference_image_count: int = 0,
    palette_constraint: PaletteConstraint | None = None,
    tile_mm: float = DEFAULT_TILE_MM,
    dpi: int = DEFAULT_DPI,
    seed: int | None = None,
) -> AuthoredDesign:
    """Compile normalized ratios and references to a schema-valid engine intent."""

    exact_ids = list(motif_ids or [])
    if len(exact_ids) > 2:
        raise PlanCompileError("each design may use at most 2 exact motif inputs")
    if len(set(exact_ids)) != len(exact_ids):
        raise PlanCompileError("exact motif inputs must be distinct")
    candidates = catalog_candidates or []
    required_references = reference_motif_indexes or set()
    sources = _resolve_motif_sources(
        plan,
        motif_ids=exact_ids,
        catalog_candidates=candidates,
        reference_motif_indexes=required_references,
        reference_image_count=reference_image_count,
    )

    palette = palette_constraint or PaletteConstraint()
    if palette.mode == "fixed" and plan.colors != palette.colors:
        raise PlanCompileError("plan colors must exactly match the fixed palette")
    if palette.mode == "fixed":
        guaranteed_visible = {plan.ground_color_index}
        for structure in plan.layers:
            if structure.type == "stripe":
                guaranteed_visible.update(band.color_index for band in structure.bands)
            elif structure.color_indices:
                # Every motif has at least one paint slot. Additional indexes are used only
                # when the resolved motif exposes more slots, so they cannot satisfy a fixed
                # palette visibility guarantee by themselves.
                guaranteed_visible.add(structure.color_indices[0])
        missing = sorted(set(range(len(plan.colors))) - guaranteed_visible)
        if missing:
            raise PlanCompileError(
                "fixed palette colors must all be guaranteed visible; missing color indexes: "
                + ", ".join(str(index) for index in missing)
            )

    slots_by_index = _slot_ids(plan)
    slots = [
        {"id": slot_id, "hex": color}
        for slot_id, color in zip(slots_by_index, plan.colors, strict=True)
    ]
    mapping = dict(zip(slots_by_index, plan.colors, strict=True))
    layers: list[dict[str, object]] = [
        {
            "id": "ground",
            "type": "background",
            "z_order": 0,
            "params": {"color": slots_by_index[plan.ground_color_index]},
        }
    ]
    stripe_plans = [layer for layer in plan.layers if layer.type == "stripe"]
    stripe_index = 0
    motif_layer_index = 0
    motif_specs: list[dict] = []
    motif_resolutions: list[dict[str, object]] = []
    motif_color_slots: dict[str, list[str]] = {}

    for structure in plan.layers:
        if structure.type == "stripe":
            layer_id = f"stripe_{stripe_index}"
            stripe_index += 1
            period_mm = round(tile_mm * structure.period_ratio, 6)
            layers.append(
                {
                    "id": layer_id,
                    "type": "stripe",
                    "z_order": len(layers),
                    "params": {
                        "angle": _DIRECTION_ANGLE[structure.direction],
                        "period_mm": period_mm,
                        "bands": [
                            {
                                "offset_mm": round(period_mm * band.offset_ratio, 6),
                                "width_mm": round(period_mm * band.width_ratio, 6),
                                "color": slots_by_index[band.color_index],
                            }
                            for band in structure.bands
                        ],
                    },
                }
            )
            continue

        source = sources[structure.motif_index]
        layer_id = f"motif_{motif_layer_index}"
        motif_layer_index += 1
        colors = [slots_by_index[index] for index in structure.color_indices]
        layers.append(
            {
                "id": layer_id,
                "type": "motif",
                "z_order": len(layers),
                "params": {
                    "motif_id": source.motif_id,
                    "size_mm": round(tile_mm * structure.size_ratio, 6),
                    "color": colors[0],
                },
                "placement": _compile_placement(
                    structure.placement,
                    tile_mm=tile_mm,
                    stripes=stripe_plans,
                ),
            }
        )
        motif_color_slots[layer_id] = colors
        if source.spec is not None:
            motif_specs.append({"layer_id": layer_id, **source.spec})
        if source.resolution is not None:
            motif_resolutions.append({"layer_id": layer_id, "scope": "whole", **source.resolution})

    return AuthoredDesign(
        intent={
            "intent_version": 1,
            "canvas": {"tile_mm": tile_mm, "dpi": dpi},
            "seed": seed if seed is not None else (plan_index + 1) * 104729,
            "production": {"method": "print", "max_colors": 12},
            "palette": {"slots": slots},
            "colorways": [{"id": "default", "name": "default", "mapping": mapping}],
            "layers": layers,
        },
        motif_specs=motif_specs,
        motif_resolutions=motif_resolutions,
        motif_color_slots=motif_color_slots,
        plan=plan.model_dump(mode="json"),
        structural_fingerprint=structural_fingerprint(plan),
    )
