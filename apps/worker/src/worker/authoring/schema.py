"""Provider-facing DesignPlan v3 schema.

The model chooses normalized structure. Engine IDs, millimetres, and point coordinates stay
behind the deterministic compiler boundary. Motif artwork, including its colors, is immutable.
"""

from __future__ import annotations

import copy
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from worker.engine.constraints import normalize_hex
from worker.engine.determinism import stable_digest

StripeDirection = Literal["horizontal", "vertical", "diagonal_up", "diagonal_down"]
PathDirection = Literal[
    "horizontal",
    "vertical",
    "diagonal_up",
    "diagonal_down",
    "diagonal_2_3_up",
    "diagonal_2_3_down",
]
MAX_STRUCTURE_LAYERS = 5


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InputMotifSource(_StrictModel):
    source: Literal["input"]
    input_index: int = Field(ge=1, le=2)


class CatalogMotifSource(_StrictModel):
    source: Literal["catalog"]
    catalog_ref: str = Field(min_length=1, max_length=40)


# Discriminated so a rejected plan yields a clean per-variant error (e.g. "poisson scatter does
# not accept order or step") the authoring retry loop can act on — a plain union buries the real
# cause under every sibling variant's errors. The provider schema strips oneOf/discriminator
# separately (Vertex can't serve them); see _servable_json_schema in adapters/gemini.py.
PlanMotifSource = Annotated[
    InputMotifSource | CatalogMotifSource,
    Field(discriminator="source"),
]


class StripeBandPlan(_StrictModel):
    offset_ratio: float = Field(ge=0.0, lt=1.0, allow_inf_nan=False)
    width_ratio: float = Field(gt=0.0, le=0.75, allow_inf_nan=False)
    color_index: int = Field(ge=0, le=7)

    @model_validator(mode="after")
    def _fits_within_period(self) -> StripeBandPlan:
        if self.offset_ratio + self.width_ratio > 1.0:
            raise ValueError("stripe band must fit within one period")
        return self


class StripeLayerPlan(_StrictModel):
    type: Literal["stripe"]
    direction: StripeDirection
    period_ratio: float = Field(gt=0.0, le=1.0, allow_inf_nan=False)
    bands: list[StripeBandPlan] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def _coverage_is_bounded(self) -> StripeLayerPlan:
        if sum(band.width_ratio for band in self.bands) > 0.75 + 1e-9:
            raise ValueError("stripe band coverage may not exceed 0.75 of one period")
        return self


class LatticePlacementPlan(_StrictModel):
    type: Literal["lattice"]
    columns: int = Field(ge=1, le=16)
    rows: int = Field(ge=1, le=16)
    drop: Literal["none", "half_row", "half_column"] = "none"
    fixed_rotation_deg: float = Field(default=0.0, ge=-180.0, le=180.0, allow_inf_nan=False)

    @model_validator(mode="after")
    def _drop_axis_count_is_even(self) -> LatticePlacementPlan:
        # Engine torus closure requires an even count along the drop axis, a parity constraint
        # neither the provider schema nor the authoring model can express reliably. Round odd
        # counts up (silent normalization, like normalize_hex) instead of rejecting downstream.
        if self.drop == "half_column":
            self.columns += self.columns % 2
        elif self.drop == "half_row":
            self.rows += self.rows % 2
        return self


# Scatter/path split by mode/kind so each variant's required fields are STRUCTURAL — enforced by
# the JSON schema's `required` (and honored by Vertex constrained decoding), not by a post-parse
# model_validator the provider schema cannot express. The authoring model was reliably omitting
# count/order/wavelength on the combined all-optional shapes; disjoint variants make that
# impossible. The remaining numeric relation (sateen step<order) is the only leftover validator.
class PoissonScatterPlan(_StrictModel):
    type: Literal["scatter"]
    mode: Literal["poisson"]
    count: int = Field(ge=1, le=256)
    min_distance_ratio: float = Field(gt=0.0, le=0.5, allow_inf_nan=False)
    fixed_rotation_deg: float = Field(default=0.0, ge=-180.0, le=180.0, allow_inf_nan=False)


class SateenScatterPlan(_StrictModel):
    type: Literal["scatter"]
    mode: Literal["sateen"]
    order: int = Field(ge=2, le=32)
    step: int = Field(ge=1, le=31)
    fixed_rotation_deg: float = Field(default=0.0, ge=-180.0, le=180.0, allow_inf_nan=False)

    @model_validator(mode="after")
    def _step_below_order(self) -> SateenScatterPlan:
        if self.step >= self.order:
            raise ValueError("sateen step must be smaller than order")
        return self


ScatterPlacementPlan = Annotated[
    PoissonScatterPlan | SateenScatterPlan,
    Field(discriminator="mode"),
]


class StraightPathPlan(_StrictModel):
    type: Literal["path"]
    kind: Literal["straight"]
    direction: PathDirection
    spacing_ratio: float = Field(gt=0.0, le=1.0, allow_inf_nan=False)
    phase_ratio: float = Field(default=0.0, ge=0.0, lt=1.0, allow_inf_nan=False)
    host_stripe_index: int | None = Field(default=None, ge=0, le=3)
    host_band_index: int | None = Field(default=None, ge=0, le=3)
    rotation: Literal["follow_path", "fixed"] = "follow_path"
    fixed_rotation_deg: float = Field(default=0.0, ge=-180.0, le=180.0, allow_inf_nan=False)

    @model_validator(mode="after")
    def _host_band_requires_stripe(self) -> StraightPathPlan:
        if self.host_band_index is not None and self.host_stripe_index is None:
            raise ValueError("host_band_index requires host_stripe_index")
        return self


class WavePathPlan(_StrictModel):
    # Wave paths carry their required ratios and have no host fields — only straight paths may be
    # stripe-hosted, so "hosted paths must be straight" is structural rather than a validator.
    type: Literal["path"]
    kind: Literal["wave"]
    direction: PathDirection
    spacing_ratio: float = Field(gt=0.0, le=1.0, allow_inf_nan=False)
    phase_ratio: float = Field(default=0.0, ge=0.0, lt=1.0, allow_inf_nan=False)
    wavelength_ratio: float = Field(gt=0.0, le=2.0, allow_inf_nan=False)
    amplitude_ratio: float = Field(ge=0.0, le=0.5, allow_inf_nan=False)
    rotation: Literal["follow_path", "fixed"] = "follow_path"
    fixed_rotation_deg: float = Field(default=0.0, ge=-180.0, le=180.0, allow_inf_nan=False)


PathPlacementPlan = Annotated[
    StraightPathPlan | WavePathPlan,
    Field(discriminator="kind"),
]


class PointTemplatePlacementPlan(_StrictModel):
    type: Literal["point_template"]
    template: Literal["quincunx_inset", "diagonal_pair", "grid4_inset"]
    fixed_rotation_deg: float = Field(default=0.0, ge=-180.0, le=180.0, allow_inf_nan=False)


PlacementPlan = Annotated[
    LatticePlacementPlan | ScatterPlacementPlan | PathPlacementPlan | PointTemplatePlacementPlan,
    Field(discriminator="type"),
]


class MotifLayerPlan(_StrictModel):
    type: Literal["motif"]
    motif_index: int = Field(ge=0, le=1)
    size_ratio: float = Field(gt=0.0, le=0.4, allow_inf_nan=False)
    placement: PlacementPlan


StructureLayerPlan = Annotated[
    StripeLayerPlan | MotifLayerPlan,
    Field(discriminator="type"),
]


class DesignPlanV3(_StrictModel):
    colors: list[str] = Field(min_length=2, max_length=8)
    ground_color_index: int = Field(ge=0, le=7)
    motifs: list[PlanMotifSource] = Field(max_length=2)
    layers: list[StructureLayerPlan] = Field(max_length=MAX_STRUCTURE_LAYERS)

    @field_validator("colors", mode="before")
    @classmethod
    def _normalize_colors(cls, value: object) -> object:
        if not isinstance(value, list):
            return value
        colors: list[str] = []
        for raw in value:
            if not isinstance(raw, str):
                raise ValueError("each color must be a HEX string")
            color = normalize_hex(raw)
            if color in colors:
                raise ValueError(f"duplicate normalized color: {color}")
            colors.append(color)
        return colors

    @model_validator(mode="after")
    def _references_are_consistent(self) -> DesignPlanV3:
        color_count = len(self.colors)
        if self.ground_color_index >= color_count:
            raise ValueError("ground_color_index is outside colors")

        motif_layers = [layer for layer in self.layers if layer.type == "motif"]
        for layer in self.layers:
            if layer.type == "stripe":
                if any(band.color_index >= color_count for band in layer.bands):
                    raise ValueError("stripe color_index is outside colors")

        used_motifs = {layer.motif_index for layer in motif_layers}
        if used_motifs != set(range(len(self.motifs))):
            raise ValueError("every declared motif must be used and motif indexes must be dense")

        stripes = [layer for layer in self.layers if layer.type == "stripe"]
        for layer in motif_layers:
            placement = layer.placement
            # Only StraightPathPlan can be stripe-hosted (wave/lattice/scatter/point never are).
            if not isinstance(placement, StraightPathPlan) or placement.host_stripe_index is None:
                continue
            if placement.host_stripe_index >= len(stripes):
                raise ValueError("host_stripe_index is outside stripe layers")
            host = stripes[placement.host_stripe_index]
            if placement.direction != host.direction:
                raise ValueError("hosted path direction must match its stripe")
            if placement.host_band_index is not None and placement.host_band_index >= len(
                host.bands
            ):
                raise ValueError("host_band_index is outside stripe bands")
        return self


def _canonical_motif_source(source: PlanMotifSource) -> dict[str, object]:
    """Return the semantic identity of a provider-facing motif source.

    Palette and placement are intentionally absent, so the fingerprint tracks what the
    plan actually repeats rather than how it was colored.
    """

    raw = source.model_dump(mode="json", exclude_none=True)
    for key, value in tuple(raw.items()):
        if isinstance(value, str):
            raw[key] = " ".join(value.split()).casefold()
    return raw


def structural_fingerprint(plan: DesignPlanV3) -> str:
    """Hash motif identity plus geometry/topology, ignoring palette-only variation."""

    layers = plan.model_dump(mode="json")["layers"]
    for layer in layers:
        if layer["type"] == "stripe":
            for band in layer["bands"]:
                band.pop("color_index", None)
    payload = {
        "motifs": [_canonical_motif_source(source) for source in plan.motifs],
        "layers": layers,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return stable_digest(canonical, 16)


def snapshot_resolved_plan(
    plan: DesignPlanV3,
    resolved_intent: dict[str, object],
) -> DesignPlanV3:
    """Freeze surviving authored motif sources to the concrete IDs used by the engine.

    The stored value remains a valid ``DesignPlanV3`` by using ``catalog_ref`` as the
    internal carrier.  Before it reaches Gemini, the adapter replaces these values
    with request-local ``current_motif_N`` aliases, so private/content-hash IDs never
    enter provider context.  Optional motif layers that the resolver soft-dropped are
    pruned together with now-unused motif sources.
    """

    raw = copy.deepcopy(plan.model_dump(mode="json"))
    plan_motif_layers = [layer for layer in plan.layers if layer.type == "motif"]
    raw_layers = resolved_intent.get("layers")
    if not isinstance(raw_layers, list):
        raise ValueError("resolved intent must contain layers")

    resolved_by_ordinal: dict[int, str] = {}
    for intent_layer in raw_layers:
        if not isinstance(intent_layer, dict) or intent_layer.get("type") != "motif":
            continue
        layer_id = intent_layer.get("id")
        if not isinstance(layer_id, str) or not layer_id.startswith("motif_"):
            raise ValueError("resolved motif layer has an unexpected ID")
        suffix = layer_id.removeprefix("motif_")
        if (
            not suffix.isdigit()
            or f"motif_{int(suffix)}" != layer_id
            or int(suffix) >= len(plan_motif_layers)
        ):
            raise ValueError("resolved motif layer does not match the authored plan")
        ordinal = int(suffix)
        if ordinal in resolved_by_ordinal:
            raise ValueError("resolved intent contains a duplicate motif layer")
        params = intent_layer.get("params")
        motif_id = params.get("motif_id") if isinstance(params, dict) else None
        if not isinstance(motif_id, str) or not motif_id:
            raise ValueError("resolved motif layer is missing a concrete motif_id")
        resolved_by_ordinal[ordinal] = motif_id

    kept_layers: list[dict[str, object]] = []
    ids_by_index: dict[int, set[str]] = {}
    motif_ordinal = 0
    for plan_layer, raw_layer in zip(plan.layers, raw["layers"], strict=True):
        if plan_layer.type != "motif":
            kept_layers.append(raw_layer)
            continue
        motif_id = resolved_by_ordinal.get(motif_ordinal)
        motif_ordinal += 1
        if motif_id is None:
            continue
        kept_layers.append(raw_layer)
        ids_by_index.setdefault(plan_layer.motif_index, set()).add(motif_id)

    used_indexes = sorted(ids_by_index)
    dense_index = {old: new for new, old in enumerate(used_indexes)}
    for layer in kept_layers:
        if layer["type"] == "motif":
            old_index = layer.get("motif_index")
            if not isinstance(old_index, int):
                raise ValueError("authored motif layer is missing motif_index")
            layer["motif_index"] = dense_index[old_index]

    frozen: list[dict[str, object]] = []
    for index in used_indexes:
        motif_ids = ids_by_index[index]
        if len(motif_ids) != 1:
            raise ValueError("one authored motif resolved to multiple concrete motif IDs")
        frozen.append({"source": "catalog", "catalog_ref": next(iter(motif_ids))})
    raw["layers"] = kept_layers
    raw["motifs"] = frozen
    return DesignPlanV3.model_validate(raw)
