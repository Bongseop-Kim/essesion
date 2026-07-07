"""stage-0 intent 검증·repair — 구조(pydantic) + 교차 검증 + 안전 수리 (worker-engine.md §1).

repair 3종: dpi 클램프, off-grid stripe period 스냅(밴드 비례), bare lane 정규화,
ground-gap(커버리지 초과 밴드 축소·균등 배치). 전부 결정론적이며 경고를 남긴다.
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from worker.config import get_settings
from worker.engine.intent import Intent
from worker.engine.palette import ColorSlot, Colorway, Palette, out_of_gamut
from worker.engine.units import ALLOWED_DPI, divides, snap_angle, snap_spacing, stripe_tiles
from worker.motifs.registry import MotifCatalog, resolve_motif


class IntentInvalid(Exception):
    def __init__(self, errors: list[str]) -> None:
        self.errors = list(errors)
        super().__init__("; ".join(self.errors))


@dataclass
class ValidationResult:
    intent: Intent
    palette: Palette
    warnings: list[str] = field(default_factory=list)


_ALLOWED_DROP_FRACTIONS = (0.5, 1 / 3, 0.25)


def _fmt_err(err: Mapping[str, Any]) -> str:
    loc = ".".join(str(p) for p in err.get("loc", ()))
    return f"{loc}: {err.get('msg', 'invalid')}" if loc else err.get("msg", "invalid")


def build_palette(intent: Intent) -> Palette:
    slots = tuple(
        ColorSlot(id=s.id, hex=s.hex, spot=s.spot, name=s.name) for s in intent.palette.slots
    )
    colorways = tuple(
        Colorway(id=c.id, name=c.name, mapping=dict(c.mapping)) for c in intent.colorways
    )
    return Palette(slots=slots, colorways=colorways)


def _layer_slot_refs(layer) -> list[str]:
    if layer.type == "background":
        return [layer.params.color]
    if layer.type == "stripe":
        return [b.color for b in layer.params.bands]
    if layer.type == "motif":
        if layer.params.colors:
            return list(layer.params.colors.values())
        if layer.params.color is not None:
            return [layer.params.color]
    return []


def _approx_int(value: float, tol: float = 1e-6) -> bool:
    return abs(value - round(value)) <= tol


def _lattice_errors(layer, placement, tile: float) -> list[str]:
    spec = placement.lattice
    if spec is None:
        return [f"layer {layer.id!r}: lattice placement requires a `lattice` spec"]
    errs: list[str] = []
    nx = round(tile / spec.cell_w_mm)
    ny = round(tile / spec.cell_h_mm)
    cap = get_settings().max_placement_instances
    if nx * ny > cap:
        errs.append(
            f"layer {layer.id!r}: lattice would place {nx * ny} instances "
            f"(> max_placement_instances {cap})"
        )
    if not divides(tile, spec.cell_w_mm):
        errs.append(
            f"layer {layer.id!r}: lattice cell_w_mm {spec.cell_w_mm} does not divide tile_mm {tile}"
        )
    if not divides(tile, spec.cell_h_mm):
        errs.append(
            f"layer {layer.id!r}: lattice cell_h_mm {spec.cell_h_mm} does not divide tile_mm {tile}"
        )
    if spec.drop_fraction is not None:
        if not any(abs(spec.drop_fraction - f) <= 1e-6 for f in _ALLOWED_DROP_FRACTIONS):
            errs.append(
                f"layer {layer.id!r}: lattice drop_fraction {spec.drop_fraction} must "
                f"be one of 1/2, 1/3, 1/4"
            )
        elif not errs:
            counts = tile / spec.cell_w_mm if spec.drop_axis == "column" else tile / spec.cell_h_mm
            if not _approx_int(counts * spec.drop_fraction):
                errs.append(
                    f"layer {layer.id!r}: lattice drop does not close on the torus "
                    f"(needs (tile/cell)*drop_fraction integer for drop_axis "
                    f"{spec.drop_axis!r})"
                )
    return errs


def _scatter_errors(layer, placement, tile: float) -> list[str]:
    spec = placement.scatter
    if spec is None:
        return [f"layer {layer.id!r}: scatter placement requires a `scatter` spec"]
    errs: list[str] = []
    if spec.mode == "poisson":
        if spec.min_dist_mm is None:
            errs.append(f"layer {layer.id!r}: scatter poisson requires min_dist_mm")
        elif spec.min_dist_mm > tile / 2:
            errs.append(
                f"layer {layer.id!r}: scatter min_dist_mm {spec.min_dist_mm} exceeds "
                f"tile_mm/2 {tile / 2}"
            )
    else:
        if spec.sateen_n is None:
            errs.append(f"layer {layer.id!r}: scatter sateen requires sateen_n")
        else:
            step = spec.sateen_step if spec.sateen_step is not None else 1
            if math.gcd(step, spec.sateen_n) != 1:
                errs.append(
                    f"layer {layer.id!r}: scatter sateen_step {step} must be coprime "
                    f"with sateen_n {spec.sateen_n} (else rows/columns align)"
                )
    return errs


def _point_set_errors(layer, placement, tile: float) -> list[str]:
    spec = placement.point_set
    if spec is None:
        return [f"layer {layer.id!r}: point_set placement requires a `point_set` spec"]
    errs: list[str] = []
    for idx, (x, y) in enumerate(spec.points):
        if not (0 <= x < tile and 0 <= y < tile):
            errs.append(
                f"layer {layer.id!r}: point_set point[{idx}] ({x}, {y}) is outside "
                f"[0, tile_mm={tile})"
            )
    return errs


def _lane_closure(placement, layers_by_id, tile: float) -> tuple[float, int, int] | None:
    if placement.host_layer is not None:
        host = layers_by_id.get(placement.host_layer)
        if host is None or host.type != "stripe":
            return None
        snapped = snap_angle(host.params.angle)
    elif placement.path is not None:
        angle = placement.path.angle if placement.path.angle is not None else 0.0
        snapped = snap_angle(angle)
    else:
        return None
    return tile * math.hypot(snapped.p, snapped.q), snapped.p, snapped.q


def _repair_stripe_period(layer, tile: float):
    """off-grid stripe period를 tile/(k·hypot)로 스냅 — 밴드 비례 스케일, 각도 불변."""
    params = layer.params
    snapped = snap_angle(params.angle)
    if stripe_tiles(tile, params.period_mm, snapped.p, snapped.q):
        return layer, None
    hypot = math.hypot(snapped.p, snapped.q)
    if hypot == 0:
        return layer, None
    k = max(1, round(tile / (params.period_mm * hypot)))
    new_period = tile / (k * hypot)
    scale = new_period / params.period_mm
    bands = [
        b.model_copy(
            update={
                "offset_mm": round(b.offset_mm * scale, 6),
                "width_mm": round(b.width_mm * scale, 6),
            }
        )
        for b in params.bands
    ]
    new_layer = layer.model_copy(
        update={
            "params": params.model_copy(update={"period_mm": round(new_period, 6), "bands": bands})
        }
    )
    warning = (
        f"stripe {layer.id!r} period_mm {params.period_mm} snapped to {new_period:.4f} "
        f"(tile-commensurate; slope {snapped.p}/{snapped.q})"
    )
    return new_layer, warning


def _repair_stripe_ground_gap(layer, cap: float):
    """밴드 커버리지가 cap을 넘으면 축소·균등 배치해 ground를 보이게 유지."""
    params = layer.params
    period = params.period_mm
    coverage = sum(b.width_mm for b in params.bands) / period
    if coverage <= cap:
        return layer, None
    scale = cap / coverage
    n = len(params.bands)
    gap = (1.0 - cap) * period / n
    bands = []
    cursor = 0.0
    for band in params.bands:
        width = round(band.width_mm * scale, 6)
        bands.append(band.model_copy(update={"offset_mm": round(cursor, 6), "width_mm": width}))
        cursor += width + gap
    new_layer = layer.model_copy(update={"params": params.model_copy(update={"bands": bands})})
    warning = (
        f"stripe {layer.id!r} bands covered the ground (coverage {coverage:.2f} > "
        f"{cap}); widths reduced to keep the background visible"
    )
    return new_layer, warning


def validate_intent(
    raw, *, repair: bool = True, motifs: MotifCatalog | None = None
) -> ValidationResult:
    # 1. 구조
    if isinstance(raw, Intent):
        intent = raw
    else:
        try:
            intent = Intent.model_validate(raw)
        except ValidationError as exc:
            raise IntentInvalid([_fmt_err(e) for e in exc.errors()]) from None

    errors: list[str] = []
    warnings: list[str] = []

    # 2. 팔레트/colorway 불변식
    try:
        palette = build_palette(intent)
    except ValueError as exc:
        raise IntentInvalid([str(exc)]) from None

    # 3. dpi 클램프
    if intent.canvas.dpi not in ALLOWED_DPI:
        if repair:
            nearest = min(ALLOWED_DPI, key=lambda d: abs(d - intent.canvas.dpi))
            warnings.append(
                f"canvas.dpi {intent.canvas.dpi} not in {ALLOWED_DPI}; clamped to {nearest}"
            )
            intent = intent.model_copy(
                update={"canvas": intent.canvas.model_copy(update={"dpi": nearest})}
            )
        else:
            errors.append(f"canvas.dpi {intent.canvas.dpi} not in {ALLOWED_DPI}")

    # 3b. off-grid stripe period 스냅 (아래 commensurate 검사보다 먼저)
    if repair:
        tile_mm = intent.canvas.tile_mm
        snapped_layers = list(intent.layers)
        snapped_any = False
        for i, la in enumerate(snapped_layers):
            if la.type == "stripe":
                repaired, warning = _repair_stripe_period(la, tile_mm)
                if warning is not None:
                    snapped_layers[i] = repaired
                    warnings.append(warning)
                    snapped_any = True
        if snapped_any:
            intent = intent.model_copy(update={"layers": snapped_layers})

    # 3c. 다중 밴드 stripe의 bare lane(start/center/end) → b0.* 정규화
    if repair:
        by_id = {la.id: la for la in intent.layers}
        repaired_layers = list(intent.layers)
        fixed_any = False
        for i, la in enumerate(repaired_layers):
            pl = getattr(la, "placement", None)
            if pl is None or pl.type != "path_following":
                continue
            if pl.lane not in ("start", "center", "end"):
                continue
            host = by_id.get(pl.host_layer)
            if host is not None and host.type == "stripe" and len(host.params.bands) > 1:
                new_lane = f"b0.{pl.lane}"
                warnings.append(
                    f"layer {la.id!r}: bare lane {pl.lane!r} on multi-band stripe "
                    f"{host.id!r} normalized to {new_lane!r} (band 0)"
                )
                repaired_layers[i] = la.model_copy(
                    update={"placement": pl.model_copy(update={"lane": new_lane})}
                )
                fixed_any = True
        if fixed_any:
            intent = intent.model_copy(update={"layers": repaired_layers})

    # 4. yarn_dyed 색 수 상한
    if intent.production.method == "yarn_dyed":
        for cw in palette.colorways:
            n = len(palette.distinct_colors(cw.id))
            if n > intent.production.max_colors:
                errors.append(
                    f"colorway {cw.id!r} uses {n} colors > max_colors "
                    f"{intent.production.max_colors}"
                )

    # 5. 색역 경고 (비차단)
    for cw in palette.colorways:
        for color in sorted(palette.distinct_colors(cw.id)):
            if color.startswith("#") and out_of_gamut(color):
                warnings.append(f"color {color} in colorway {cw.id!r} likely outside CMYK gamut")

    # 6. 레이어·placement 교차 검증
    all_layer_ids = [layer.id for layer in intent.layers]
    layer_ids = set(all_layer_ids)
    layers_by_id = {layer.id: layer for layer in intent.layers}
    if len(all_layer_ids) != len(layer_ids):
        dupes = sorted({i for i in all_layer_ids if all_layer_ids.count(i) > 1})
        errors.append(f"duplicate layer id: {dupes}")
    tile = intent.canvas.tile_mm
    if tile > get_settings().max_tile_mm:
        errors.append(f"canvas.tile_mm {tile} exceeds max_tile_mm {get_settings().max_tile_mm}")

    for layer in intent.layers:
        for slot_id in _layer_slot_refs(layer):
            if slot_id not in palette.slot_ids():
                errors.append(f"layer {layer.id!r} references unknown color slot {slot_id!r}")

        if layer.type == "motif":
            try:
                motif = resolve_motif(layer.params.motif_id, motifs)
            except ValueError:
                motif = None  # 미등록 모티프는 compose에 위임 (stale 카탈로그 422 방지)
            if motif is not None:
                slots = set(motif.color_slots)
                if layer.params.colors is not None:
                    keys = set(layer.params.colors)
                    if keys != slots:
                        errors.append(
                            f"layer {layer.id!r}: colors bind {sorted(keys)} but motif "
                            f"{motif.id!r} has color_slots {sorted(slots)} (every slot "
                            f"must be bound exactly once; no unbound slots)"
                        )
                elif layer.params.color is not None and slots != {"s0"}:
                    errors.append(
                        f"layer {layer.id!r}: motif {motif.id!r} is multi-color "
                        f"(color_slots {sorted(slots)}); use a `colors` mapping"
                    )
            if layer.params.size_mm > tile:
                errors.append(
                    f"layer {layer.id!r}: motif size_mm {layer.params.size_mm} exceeds "
                    f"tile_mm {tile} (boundary clones would self-overlap)"
                )

        if layer.type == "stripe":
            snapped = snap_angle(layer.params.angle)
            if not stripe_tiles(tile, layer.params.period_mm, snapped.p, snapped.q):
                errors.append(
                    f"layer {layer.id!r}: stripe (angle {layer.params.angle}, "
                    f"period_mm {layer.params.period_mm}) is not tile-commensurate; a "
                    f"stripe tiles only when tile_mm = k*period_mm*hypot(p, q) "
                    f"(snapped slope {snapped.p}/{snapped.q})"
                )

        placement = getattr(layer, "placement", None)
        if placement is not None:
            if placement.type == "path_following":
                if placement.spacing_mm is None:
                    errors.append(
                        f"layer {layer.id!r}: path_following placement requires spacing_mm"
                    )
                has_host_lane = placement.host_layer is not None and placement.lane is not None
                has_host_field = placement.host_layer is not None or placement.lane is not None
                has_path = placement.path is not None
                if has_path and has_host_field:
                    errors.append(
                        f"layer {layer.id!r}: path_following must specify only one "
                        "mode: host_layer+lane or standalone path"
                    )
                elif not (has_host_lane or has_path):
                    errors.append(
                        f"layer {layer.id!r}: path_following requires either "
                        f"host_layer+lane or a standalone path"
                    )
                if placement.spacing_mm is not None and placement.spacing_mm > 0:
                    lane = _lane_closure(placement, layers_by_id, tile)
                    if lane is not None:
                        closure, lp, lq = lane
                        if not divides(closure, placement.spacing_mm):
                            n, eff = snap_spacing(closure, placement.spacing_mm)
                            warnings.append(
                                f"layer {layer.id!r}: spacing_mm "
                                f"{placement.spacing_mm} snapped to {eff:.4f}mm for "
                                f"uniform placement (lane closure {closure:.4f} = "
                                f"tile*hypot({lp}, {lq}); {n} instances)"
                            )
            elif placement.type == "lattice":
                errors.extend(_lattice_errors(layer, placement, tile))
            elif placement.type == "scatter":
                errors.extend(_scatter_errors(layer, placement, tile))
            elif placement.type == "point_set":
                errors.extend(_point_set_errors(layer, placement, tile))

            if placement.host_layer is not None:
                if placement.host_layer == layer.id:
                    errors.append(f"layer {layer.id!r}: host_layer cannot reference itself")
                elif placement.host_layer not in layer_ids:
                    errors.append(
                        f"layer {layer.id!r}: host_layer {placement.host_layer!r} does not exist"
                    )
                else:
                    host = layers_by_id.get(placement.host_layer)
                    if (
                        placement.type == "path_following"
                        and host is not None
                        and host.type != "stripe"
                    ):
                        errors.append(
                            f"layer {layer.id!r}: path_following host_layer "
                            f"{placement.host_layer!r} must be a stripe, not {host.type!r}"
                        )
            if (
                placement.path is not None
                and placement.path.kind == "wave"
                and placement.path.wavelength is not None
            ):
                angle = placement.path.angle if placement.path.angle is not None else 0.0
                snapped = snap_angle(angle)
                closure = tile * math.hypot(snapped.p, snapped.q)
                if not divides(closure, placement.path.wavelength):
                    errors.append(
                        f"layer {layer.id!r}: wave wavelength "
                        f"{placement.path.wavelength} does not divide the lane closure "
                        f"length {closure} (tile*hypot({snapped.p}, {snapped.q}))"
                    )

    if errors:
        raise IntentInvalid(errors)

    # ground-gap repair: 불투명 배경 위 불투명 stripe가 ground를 다 덮지 못하게
    if repair:
        cap = get_settings().stripe_max_band_coverage
        opaque_bg_z = [
            la.z_order for la in intent.layers if la.type == "background" and la.opacity == 1.0
        ]
        if opaque_bg_z:
            min_bg_z = min(opaque_bg_z)
            new_layers = list(intent.layers)
            changed = False
            for i, la in enumerate(new_layers):
                if la.type == "stripe" and la.opacity == 1.0 and la.z_order > min_bg_z:
                    repaired, warning = _repair_stripe_ground_gap(la, cap)
                    if warning is not None:
                        new_layers[i] = repaired
                        warnings.append(warning)
                        changed = True
            if changed:
                intent = intent.model_copy(update={"layers": new_layers})

    return ValidationResult(intent=intent, palette=palette, warnings=warnings)
