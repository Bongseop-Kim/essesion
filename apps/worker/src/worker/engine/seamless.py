"""seamless 보증 — 경계 클론(렌더 AABB 기반) + 공약 불변식 재확인 (worker-engine.md §3)."""

import math

from worker.engine.intent import Intent
from worker.engine.placement import Instance
from worker.engine.units import divides, snap_angle, stripe_tiles
from worker.motifs.registry import MotifDef

_EPS = 1e-9
_OFFSETS = (-1, 0, 1)  # 고정 순회 순서 → 결정론적 클론 순서


def _rendered_aabb(
    motif: MotifDef, inst: Instance, size_mm: float
) -> tuple[float, float, float, float]:
    """scale → rotate(anchor 기준) → translate 후의 AABB — compose transform과 동일 순서."""
    min_x, min_y, max_x, max_y = motif.bbox_mm
    extent = max(max_x - min_x, max_y - min_y)
    scale = size_mm / extent
    ax, ay = motif.anchor
    theta = math.radians(inst.rotation_deg)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    xs: list[float] = []
    ys: list[float] = []
    for cx, cy in ((min_x, min_y), (min_x, max_y), (max_x, min_y), (max_x, max_y)):
        sx, sy = (cx - ax) * scale, (cy - ay) * scale
        rx = sx * cos_t - sy * sin_t
        ry = sx * sin_t + sy * cos_t
        xs.append(inst.x_mm + rx)
        ys.append(inst.y_mm + ry)
    return (min(xs), min(ys), max(xs), max(ys))


def clone_instances(
    instances: list[Instance], *, motif: MotifDef, size_mm: float, tile_mm: float
) -> list[Instance]:
    """렌더 AABB가 타일 경계를 넘는 인스턴스에 시프트 복제를 덧붙인다(원본 뒤, 고정 순서)."""
    out: list[Instance] = []
    for inst in instances:
        out.append(inst)
        min_x, min_y, max_x, max_y = _rendered_aabb(motif, inst, size_mm)
        crosses = min_x < -_EPS or min_y < -_EPS or max_x > tile_mm + _EPS or max_y > tile_mm + _EPS
        if not crosses:
            continue
        for dx in _OFFSETS:
            for dy in _OFFSETS:
                if dx == 0 and dy == 0:
                    continue
                s_min_x = min_x + dx * tile_mm
                s_min_y = min_y + dy * tile_mm
                s_max_x = max_x + dx * tile_mm
                s_max_y = max_y + dy * tile_mm
                outside = (
                    s_max_x < -_EPS
                    or s_max_y < -_EPS
                    or s_min_x > tile_mm + _EPS
                    or s_min_y > tile_mm + _EPS
                )
                if outside:
                    continue
                out.append(
                    Instance(inst.x_mm + dx * tile_mm, inst.y_mm + dy * tile_mm, inst.rotation_deg)
                )
    return out


def assert_seamless_invariants(intent: Intent) -> None:
    """generate 경계의 by-construction 가드 — 위반 시 AssertionError."""
    tile = intent.canvas.tile_mm
    for layer in intent.layers:
        if layer.type == "stripe":
            period = layer.params.period_mm
            snapped = snap_angle(layer.params.angle)
            if not stripe_tiles(tile, period, snapped.p, snapped.q):
                raise AssertionError(
                    f"layer {layer.id!r}: stripe (angle {layer.params.angle}, period {period}) "
                    f"is not tile-commensurate (snapped slope {snapped.p}/{snapped.q}); "
                    f"requires tile_mm == k*period_mm*hypot(p, q)"
                )
        elif layer.type == "motif":
            if layer.params.size_mm > tile:
                raise AssertionError(
                    f"layer {layer.id!r}: motif size_mm {layer.params.size_mm} exceeds "
                    f"tile_mm {tile} (boundary clones would self-overlap)"
                )
            placement = layer.placement
            if placement is None:
                continue
            if (
                placement.path is not None
                and placement.path.kind == "wave"
                and placement.path.wavelength is not None
            ):
                angle = placement.path.angle if placement.path.angle is not None else 0.0
                snapped = snap_angle(angle)
                closure = tile * math.hypot(snapped.p, snapped.q)
                if not divides(closure, placement.path.wavelength):
                    raise AssertionError(
                        f"layer {layer.id!r}: wave wavelength {placement.path.wavelength} "
                        f"does not divide the lane closure length {closure}"
                    )
            if placement.type == "lattice" and placement.lattice is not None:
                spec = placement.lattice
                if not (divides(tile, spec.cell_w_mm) and divides(tile, spec.cell_h_mm)):
                    raise AssertionError(
                        f"layer {layer.id!r}: lattice cell "
                        f"({spec.cell_w_mm}, {spec.cell_h_mm}) does not divide tile_mm {tile}"
                    )
            if placement.type == "scatter" and placement.scatter is not None:
                spec = placement.scatter
                if spec.mode == "sateen" and spec.sateen_n is not None:
                    step = spec.sateen_step if spec.sateen_step is not None else 1
                    if math.gcd(step, spec.sateen_n) != 1:
                        raise AssertionError(
                            f"layer {layer.id!r}: sateen_step {step} is not coprime "
                            f"with sateen_n {spec.sateen_n}"
                        )
