"""Structured user constraints applied at the deterministic engine boundary.

Gemini is asked to honor these controls, but the request is not trusted to prompt text alone.
This module rewrites the authored intent into the small set of physical engine primitives that
the renderer actually supports.  The resulting intent remains the complete reproducibility
record consumed by candidate generation.
"""

from __future__ import annotations

import copy
import math
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_SCALE_FRACTION = {"small": 0.10, "medium": 0.18, "large": 0.28}
_LATTICE_AXIS_COUNT = {"sparse": 4, "medium": 6, "dense": 8}
_PATH_REPEAT_COUNT = {"sparse": 4, "medium": 8, "dense": 12}
_SCATTER_COUNT = {"sparse": 8, "medium": 16, "dense": 28}
_DIRECTION_ANGLE = {"horizontal": 0.0, "vertical": 90.0, "diagonal": -45.0}


class ConstraintInvalid(ValueError):
    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))


def normalize_hex(value: str) -> str:
    value = value.strip()
    if not _HEX.fullmatch(value):
        raise ValueError("color must be #RGB or #RRGGBB")
    digits = value[1:]
    if len(digits) == 3:
        digits = "".join(char * 2 for char in digits)
    return f"#{digits.upper()}"


class PaletteConstraint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["auto", "fixed"] = "auto"
    colors: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("colors", mode="before")
    @classmethod
    def _normalize_colors(cls, value: object) -> object:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("colors must be an array")
        normalized: list[str] = []
        for raw in value:
            if not isinstance(raw, str):
                raise ValueError("each color must be a HEX string")
            color = normalize_hex(raw)
            if color not in normalized:
                normalized.append(color)
        return normalized

    @model_validator(mode="after")
    def _mode_matches_colors(self) -> PaletteConstraint:
        if self.mode == "auto" and self.colors:
            raise ValueError("automatic palette must not include fixed colors")
        if self.mode == "fixed" and not 2 <= len(self.colors) <= 5:
            raise ValueError("fixed palette requires 2 to 5 distinct colors")
        return self


class PatternConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    motif_scale: Literal["auto", "small", "medium", "large"] = "auto"
    density: Literal["auto", "sparse", "medium", "dense"] = "auto"
    arrangement: Literal["auto", "lattice", "staggered", "scatter"] = "auto"
    direction: Literal["auto", "vertical", "horizontal", "diagonal"] = "auto"

    def is_automatic(self) -> bool:
        return all(
            value == "auto"
            for value in (self.motif_scale, self.density, self.arrangement, self.direction)
        )


def _ordered_slot_refs(raw: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    layers = raw.get("layers")
    if not isinstance(layers, list):
        return refs
    for layer in layers:
        if not isinstance(layer, dict):
            continue
        params = layer.get("params")
        if not isinstance(params, dict):
            continue
        layer_type = layer.get("type")
        candidates: list[object] = []
        if layer_type == "background":
            candidates.append(params.get("color"))
        elif layer_type == "stripe":
            bands = params.get("bands")
            if isinstance(bands, list):
                candidates.extend(
                    band.get("color") for band in bands if isinstance(band, dict)
                )
        elif layer_type == "motif":
            colors = params.get("colors")
            if isinstance(colors, dict) and colors:
                candidates.extend(colors[key] for key in sorted(colors))
            else:
                candidates.append(params.get("color"))
        for candidate in candidates:
            if isinstance(candidate, str) and candidate and candidate not in refs:
                refs.append(candidate)
    return refs


def _apply_fixed_palette(raw: dict[str, Any], constraint: PaletteConstraint) -> None:
    if constraint.mode != "fixed":
        return
    palette = raw.get("palette")
    slots = palette.get("slots") if isinstance(palette, dict) else None
    if not isinstance(slots, list):
        raise ConstraintInvalid(["fixed palette requires intent.palette.slots"])
    slot_by_id = {
        slot.get("id"): slot
        for slot in slots
        if isinstance(slot, dict) and isinstance(slot.get("id"), str)
    }
    refs = _ordered_slot_refs(raw)
    unknown = [slot_id for slot_id in refs if slot_id not in slot_by_id]
    if unknown:
        raise ConstraintInvalid([f"fixed palette references unknown slots: {unknown}"])
    if len(refs) < len(constraint.colors):
        raise ConstraintInvalid(
            [
                "fixed palette needs at least "
                f"{len(constraint.colors)} color slots used by layers; authored intent uses "
                f"{len(refs)}"
            ]
        )
    ordered_ids = refs + [slot_id for slot_id in slot_by_id if slot_id not in refs]
    mapping = {
        slot_id: constraint.colors[index % len(constraint.colors)]
        for index, slot_id in enumerate(ordered_ids)
    }
    for slot_id, slot in slot_by_id.items():
        slot["hex"] = mapping[slot_id]
        slot.pop("spot", None)
    raw["colorways"] = [{"id": "default", "name": "fixed", "mapping": mapping}]


def _motif_layers(raw: dict[str, Any]) -> list[dict[str, Any]]:
    layers = raw.get("layers")
    if not isinstance(layers, list):
        return []
    return [layer for layer in layers if isinstance(layer, dict) and layer.get("type") == "motif"]


def _auto_axis_count(tile: float, layer: dict[str, Any]) -> int:
    params = layer.get("params")
    size = params.get("size_mm") if isinstance(params, dict) else None
    if not isinstance(size, int | float) or size <= 0:
        return 6
    count = max(2, min(10, round(tile / max(float(size) * 1.8, tile / 10))))
    return count


def _density_axis_count(density: str, tile: float, layer: dict[str, Any]) -> int:
    if density != "auto":
        return _LATTICE_AXIS_COUNT[density]
    return _auto_axis_count(tile, layer)


def _lattice_placement(
    *, tile: float, layer: dict[str, Any], density: str, staggered: bool
) -> dict[str, Any]:
    count = _density_axis_count(density, tile, layer)
    if staggered and count % 2:
        count = min(10, count + 1)
    lattice: dict[str, Any] = {
        "cell_w_mm": round(tile / count, 6),
        "cell_h_mm": round(tile / count, 6),
    }
    if staggered:
        lattice.update({"drop_fraction": 0.5, "drop_axis": "column"})
    return {"type": "lattice", "lattice": lattice}


def _scatter_placement(
    *, tile: float, layer: dict[str, Any], density: str
) -> dict[str, Any]:
    axis = _density_axis_count(density, tile, layer)
    count = _SCATTER_COUNT[density] if density != "auto" else max(4, round(axis * axis * 0.5))
    return {
        "type": "scatter",
        "scatter": {
            "mode": "poisson",
            "min_dist_mm": round(tile / axis, 6),
            "count": count,
        },
    }


def _apply_pattern(raw: dict[str, Any], constraint: PatternConstraints) -> None:
    if constraint.is_automatic():
        return
    canvas = raw.get("canvas")
    tile = canvas.get("tile_mm") if isinstance(canvas, dict) else None
    if not isinstance(tile, int | float) or not math.isfinite(tile) or tile <= 0:
        raise ConstraintInvalid(["pattern constraints require a positive canvas.tile_mm"])
    tile = float(tile)
    motifs = _motif_layers(raw)
    motif_controls = (constraint.motif_scale, constraint.density, constraint.arrangement)
    if any(value != "auto" for value in motif_controls) and not motifs:
        raise ConstraintInvalid(["selected pattern constraints require at least one motif layer"])

    for layer in motifs:
        params = layer.get("params")
        if not isinstance(params, dict):
            raise ConstraintInvalid(["motif layer is missing params"])
        if constraint.motif_scale != "auto":
            params["size_mm"] = round(tile * _SCALE_FRACTION[constraint.motif_scale], 6)

        if constraint.arrangement == "lattice":
            layer["placement"] = _lattice_placement(
                tile=tile, layer=layer, density=constraint.density, staggered=False
            )
        elif constraint.arrangement == "staggered":
            layer["placement"] = _lattice_placement(
                tile=tile, layer=layer, density=constraint.density, staggered=True
            )
        elif constraint.arrangement == "scatter":
            layer["placement"] = _scatter_placement(
                tile=tile, layer=layer, density=constraint.density
            )
        elif constraint.density != "auto":
            placement = layer.get("placement")
            if not isinstance(placement, dict):
                raise ConstraintInvalid([f"motif layer {layer.get('id')!r} has no placement"])
            placement_type = placement.get("type")
            if placement_type == "lattice":
                replacement = _lattice_placement(
                    tile=tile,
                    layer=layer,
                    density=constraint.density,
                    staggered=bool(
                        isinstance(placement.get("lattice"), dict)
                        and placement["lattice"].get("drop_fraction") is not None
                    ),
                )
                layer["placement"] = replacement
            elif placement_type == "scatter":
                layer["placement"] = _scatter_placement(
                    tile=tile, layer=layer, density=constraint.density
                )
            elif placement_type == "path_following":
                placement["spacing_mm"] = round(
                    tile / _PATH_REPEAT_COUNT[constraint.density], 6
                )
            else:
                raise ConstraintInvalid(
                    [f"density is not supported for placement {placement_type!r}"]
                )

    if constraint.direction != "auto":
        angle = _DIRECTION_ANGLE[constraint.direction]
        affected = False
        layers = raw.get("layers")
        assert isinstance(layers, list)
        for layer in layers:
            if not isinstance(layer, dict):
                continue
            if layer.get("type") == "stripe" and isinstance(layer.get("params"), dict):
                layer["params"]["angle"] = angle
                affected = True
            elif layer.get("type") == "motif" and isinstance(layer.get("placement"), dict):
                placement = layer["placement"]
                placement["fixed_rotation_deg"] = angle
                if placement.get("type") == "path_following":
                    placement["rotation"] = "fixed"
                affected = True
        if not affected:
            raise ConstraintInvalid(["selected direction requires a stripe or motif layer"])


def apply_generation_constraints(
    raw: dict[str, Any],
    *,
    palette: PaletteConstraint,
    pattern: PatternConstraints,
) -> dict[str, Any]:
    """Return a constrained deep copy; never partially mutate the caller on failure."""

    constrained = copy.deepcopy(raw)
    _apply_fixed_palette(constrained, palette)
    _apply_pattern(constrained, pattern)
    return constrained


def assert_constraints_satisfied(
    raw: Any,
    *,
    palette: PaletteConstraint,
    pattern: PatternConstraints,
) -> None:
    """Fail closed if a later engine stage drifts from an explicit user constraint."""

    if hasattr(raw, "model_dump"):
        raw = raw.model_dump(mode="json", exclude_none=True)
    if not isinstance(raw, dict):
        raise ConstraintInvalid(["constrained intent must be an object"])
    errors: list[str] = []

    if palette.mode == "fixed":
        colorways = raw.get("colorways")
        default = colorways[0] if isinstance(colorways, list) and len(colorways) == 1 else None
        mapping = default.get("mapping") if isinstance(default, dict) else None
        if (
            not isinstance(default, dict)
            or not isinstance(mapping, dict)
            or default.get("id") != "default"
        ):
            errors.append("fixed palette must resolve to exactly one default colorway")
        else:
            mapped = set(mapping.values())
            requested = set(palette.colors)
            if not mapped <= requested:
                errors.append("fixed palette contains a color outside the request")
            used = {mapping[slot] for slot in _ordered_slot_refs(raw) if slot in mapping}
            missing = [color for color in palette.colors if color not in used]
            if missing:
                errors.append(f"fixed palette colors are not used by rendered layers: {missing}")

    canvas = raw.get("canvas")
    tile = canvas.get("tile_mm") if isinstance(canvas, dict) else None
    motifs = _motif_layers(raw)
    if isinstance(tile, int | float) and tile > 0:
        tile = float(tile)
        for layer in motifs:
            params = layer.get("params")
            placement = layer.get("placement")
            layer_id = layer.get("id")
            if pattern.motif_scale != "auto" and isinstance(params, dict):
                expected = round(tile * _SCALE_FRACTION[pattern.motif_scale], 6)
                if not math.isclose(float(params.get("size_mm", -1)), expected, abs_tol=1e-6):
                    errors.append(f"motif layer {layer_id!r} does not satisfy motif_scale")
            if not isinstance(placement, dict):
                continue
            placement_type = placement.get("type")
            lattice = placement.get("lattice")
            scatter = placement.get("scatter")
            if pattern.arrangement == "lattice" and (
                placement_type != "lattice"
                or not isinstance(lattice, dict)
                or lattice.get("drop_fraction") is not None
            ):
                errors.append(f"motif layer {layer_id!r} is not a regular lattice")
            elif pattern.arrangement == "staggered" and (
                placement_type != "lattice"
                or not isinstance(lattice, dict)
                or not math.isclose(float(lattice.get("drop_fraction", 0)), 0.5, abs_tol=1e-6)
            ):
                errors.append(f"motif layer {layer_id!r} is not a half-drop lattice")
            elif pattern.arrangement == "scatter" and (
                placement_type != "scatter"
                or not isinstance(scatter, dict)
                or scatter.get("mode") != "poisson"
            ):
                errors.append(f"motif layer {layer_id!r} is not Poisson scatter")

            if pattern.density != "auto":
                axis = _LATTICE_AXIS_COUNT[pattern.density]
                if placement_type == "lattice" and isinstance(lattice, dict):
                    expected_cell = round(tile / axis, 6)
                    for key in ("cell_w_mm", "cell_h_mm"):
                        if not math.isclose(
                            float(lattice.get(key, -1)), expected_cell, abs_tol=1e-6
                        ):
                            errors.append(
                                f"motif layer {layer_id!r} does not satisfy density"
                            )
                            break
                elif placement_type == "scatter" and isinstance(scatter, dict):
                    if scatter.get("count") != _SCATTER_COUNT[pattern.density]:
                        errors.append(f"motif layer {layer_id!r} does not satisfy density")
                elif placement_type == "path_following":
                    expected_spacing = round(tile / _PATH_REPEAT_COUNT[pattern.density], 6)
                    if not math.isclose(
                        float(placement.get("spacing_mm", -1)), expected_spacing, abs_tol=1e-6
                    ):
                        errors.append(f"motif layer {layer_id!r} does not satisfy density")

            if pattern.direction != "auto":
                expected_angle = _DIRECTION_ANGLE[pattern.direction]
                if not math.isclose(
                    float(placement.get("fixed_rotation_deg", math.inf)),
                    expected_angle,
                    abs_tol=1e-6,
                ):
                    errors.append(f"motif layer {layer_id!r} does not satisfy direction")

        if pattern.direction != "auto":
            expected_angle = _DIRECTION_ANGLE[pattern.direction]
            layers = raw.get("layers")
            if isinstance(layers, list):
                for layer in layers:
                    if not isinstance(layer, dict) or layer.get("type") != "stripe":
                        continue
                    params = layer.get("params")
                    angle = params.get("angle") if isinstance(params, dict) else None
                    if not isinstance(angle, int | float) or not math.isclose(
                        float(angle), expected_angle, abs_tol=1e-6
                    ):
                        errors.append(
                            f"stripe layer {layer.get('id')!r} does not satisfy direction"
                        )

    if errors:
        raise ConstraintInvalid(list(dict.fromkeys(errors)))


def pattern_prompt_lines(constraint: PatternConstraints) -> list[str]:
    if constraint.is_automatic():
        return []
    return [
        "Pattern controls are binding and are enforced by the engine:",
        f"- motif_scale={constraint.motif_scale}",
        f"- density={constraint.density}",
        f"- arrangement={constraint.arrangement} "
        "(lattice=regular grid, staggered=half-drop lattice, scatter=Poisson scatter)",
        f"- direction={constraint.direction}",
    ]
