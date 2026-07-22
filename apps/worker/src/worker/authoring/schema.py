"""Provider-facing DesignPlan v3 schema.

The model chooses normalized structure. Engine IDs, millimetres, point coordinates, and
motif color-slot names stay behind the deterministic compiler boundary.
"""

from __future__ import annotations

import hashlib
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from worker.engine.constraints import normalize_hex

StripeDirection = Literal["horizontal", "vertical", "diagonal_up", "diagonal_down"]
PathDirection = Literal[
    "horizontal",
    "vertical",
    "diagonal_up",
    "diagonal_down",
    "diagonal_2_3_up",
    "diagonal_2_3_down",
]


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InputMotifSource(_StrictModel):
    source: Literal["input"]
    input_index: int = Field(ge=1, le=2)


class CatalogMotifSource(_StrictModel):
    source: Literal["catalog"]
    catalog_ref: str = Field(min_length=1, max_length=40)


class ReferenceMotifSource(_StrictModel):
    source: Literal["reference"]
    reference_image_index: int = Field(ge=1, le=5)
    subject: str = Field(min_length=1, max_length=80)
    scope: Literal["whole", "partial"] = "whole"
    style: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=160)

    @field_validator("subject")
    @classmethod
    def _strip_subject(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("reference subject may not be blank")
        return clean

    @field_validator("style", "description")
    @classmethod
    def _strip_optional_text(cls, value: str | None) -> str | None:
        clean = value.strip() if value is not None else None
        return clean or None


PlanMotifSource = Annotated[
    InputMotifSource | CatalogMotifSource | ReferenceMotifSource,
    Field(discriminator="source"),
]


class StripeBandPlan(_StrictModel):
    offset_ratio: float = Field(ge=0.0, lt=1.0, allow_inf_nan=False)
    width_ratio: float = Field(gt=0.0, le=0.75, allow_inf_nan=False)
    color_index: int = Field(ge=0, le=7)


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


class ScatterPlacementPlan(_StrictModel):
    type: Literal["scatter"]
    mode: Literal["poisson", "sateen"]
    count: int | None = Field(default=None, ge=1, le=256)
    min_distance_ratio: float | None = Field(default=None, gt=0.0, le=0.5, allow_inf_nan=False)
    order: int | None = Field(default=None, ge=2, le=32)
    step: int | None = Field(default=None, ge=1, le=31)
    fixed_rotation_deg: float = Field(default=0.0, ge=-180.0, le=180.0, allow_inf_nan=False)

    @model_validator(mode="after")
    def _mode_fields_match(self) -> ScatterPlacementPlan:
        if self.mode == "poisson":
            if self.count is None or self.min_distance_ratio is None:
                raise ValueError("poisson scatter requires count and min_distance_ratio")
            if self.order is not None or self.step is not None:
                raise ValueError("poisson scatter does not accept order or step")
        else:
            if self.order is None or self.step is None:
                raise ValueError("sateen scatter requires order and step")
            if self.step >= self.order:
                raise ValueError("sateen step must be smaller than order")
            if self.count is not None or self.min_distance_ratio is not None:
                raise ValueError("sateen scatter does not accept count or min_distance_ratio")
        return self


class PathPlacementPlan(_StrictModel):
    type: Literal["path"]
    kind: Literal["straight", "wave"]
    direction: PathDirection
    spacing_ratio: float = Field(gt=0.0, le=1.0, allow_inf_nan=False)
    phase_ratio: float = Field(default=0.0, ge=0.0, lt=1.0, allow_inf_nan=False)
    wavelength_ratio: float | None = Field(default=None, gt=0.0, le=2.0, allow_inf_nan=False)
    amplitude_ratio: float | None = Field(default=None, ge=0.0, le=0.5, allow_inf_nan=False)
    host_stripe_index: int | None = Field(default=None, ge=0, le=3)
    host_band_index: int | None = Field(default=None, ge=0, le=3)
    rotation: Literal["follow_path", "fixed"] = "follow_path"
    fixed_rotation_deg: float = Field(default=0.0, ge=-180.0, le=180.0, allow_inf_nan=False)

    @model_validator(mode="after")
    def _path_fields_match(self) -> PathPlacementPlan:
        if self.kind == "wave":
            if self.wavelength_ratio is None or self.amplitude_ratio is None:
                raise ValueError("wave path requires wavelength_ratio and amplitude_ratio")
            if self.host_stripe_index is not None:
                raise ValueError("hosted stripe paths must be straight")
        elif self.wavelength_ratio is not None or self.amplitude_ratio is not None:
            raise ValueError("straight path does not accept wave ratios")
        if self.host_band_index is not None and self.host_stripe_index is None:
            raise ValueError("host_band_index requires host_stripe_index")
        return self


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
    color_indices: list[int] = Field(min_length=1, max_length=8)
    placement: PlacementPlan

    @field_validator("color_indices")
    @classmethod
    def _color_indexes_are_bounded(cls, values: list[int]) -> list[int]:
        if any(value < 0 or value > 7 for value in values):
            raise ValueError("motif color indexes must be between 0 and 7")
        return values


StructureLayerPlan = Annotated[
    StripeLayerPlan | MotifLayerPlan,
    Field(discriminator="type"),
]


class DesignPlanV3(_StrictModel):
    colors: list[str] = Field(min_length=2, max_length=8)
    ground_color_index: int = Field(ge=0, le=7)
    motifs: list[PlanMotifSource] = Field(max_length=2)
    layers: list[StructureLayerPlan] = Field(max_length=4)

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
            if color not in colors:
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
            elif any(index >= color_count for index in layer.color_indices):
                raise ValueError("motif color_index is outside colors")

        used_motifs = {layer.motif_index for layer in motif_layers}
        if used_motifs != set(range(len(self.motifs))):
            raise ValueError("every declared motif must be used and motif indexes must be dense")

        stripes = [layer for layer in self.layers if layer.type == "stripe"]
        for layer in motif_layers:
            placement = layer.placement
            if placement.type != "path" or placement.host_stripe_index is None:
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


class DesignPlansV3(_StrictModel):
    plans: list[DesignPlanV3] = Field(min_length=2, max_length=4)


def structural_fingerprint(plan: DesignPlanV3) -> str:
    """Hash geometry/topology while deliberately ignoring palette-only variation."""

    layers = plan.model_dump(mode="json")["layers"]
    for layer in layers:
        if layer["type"] == "stripe":
            for band in layer["bands"]:
                band.pop("color_index", None)
        else:
            layer.pop("color_indices", None)
    payload = {"motif_count": len(plan.motifs), "layers": layers}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
