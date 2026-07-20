"""placement 4종 — 토러스 좌표의 인스턴스 생성 (worker-engine.md §3).

scatter poisson만 RNG를 소비한다(시도당 x, y 정확히 2회). 명시적 고정 회전은 RNG를
소비하지 않으며, 필드가 없는 기존 intent는 계속 0°라 byte-identical이다.
"""

import math
import random
from dataclasses import dataclass

from worker.config import get_settings
from worker.engine.host import Centerline, resolve_lane
from worker.engine.intent import MotifLayer, PathSpec, Placement, ScatterSpec
from worker.engine.primitives import Stripe
from worker.engine.units import snap_angle, snap_spacing

_EPS = 1e-9
_ATTEMPTS_PER_TARGET = 30
_HEX_PACKING_FACTOR = math.sqrt(3) / 2


@dataclass(frozen=True)
class Instance:
    x_mm: float
    y_mm: float
    rotation_deg: float


def place(layer: MotifLayer, host: Stripe | None, tile_mm: float, seed: int) -> list[Instance]:
    placement = layer.placement
    if placement is None:
        raise ValueError(f"motif layer {layer.id!r} has no placement")
    if placement.type == "path_following":
        return place_path_following(host, placement, tile_mm)
    if placement.type == "lattice":
        return place_lattice(placement, tile_mm)
    if placement.type == "scatter":
        return place_scatter(placement, tile_mm, seed)
    if placement.type == "point_set":
        return place_point_set(placement, tile_mm)
    raise ValueError(f"unsupported placement type: {placement.type!r}")


# ---- path_following ----


def _centerline_from_path(path: PathSpec, tile_mm: float) -> Centerline:
    angle = path.angle if path.angle is not None else 0.0
    snapped = snap_angle(angle)
    if path.kind == "wave":
        if path.wavelength is None or path.amplitude is None:
            raise ValueError("wave path requires wavelength and amplitude")
        return Centerline(
            angle_deg=snapped.angle_deg,
            offset_mm=0.0,
            p=snapped.p,
            q=snapped.q,
            kind="wave",
            wavelength_mm=path.wavelength,
            amplitude_mm=path.amplitude,
        )
    return Centerline(angle_deg=snapped.angle_deg, offset_mm=0.0, p=snapped.p, q=snapped.q)


def _resolve_centerline(host: Stripe | None, placement: Placement, tile_mm: float) -> Centerline:
    if placement.path is not None and placement.host_layer is None:
        return _centerline_from_path(placement.path, tile_mm)
    if placement.lane is None:
        raise ValueError("path_following placement requires `lane` (or a standalone `path`)")
    if host is None:
        raise ValueError("path_following placement requires a host layer for `lane`")
    return resolve_lane(host.lanes(), placement.lane).centerline_path


def place_path_following(
    host: Stripe | None, placement: Placement, tile_mm: float
) -> list[Instance]:
    if placement.spacing_mm is None:
        raise ValueError("path_following placement requires `spacing_mm`")
    centerline = _resolve_centerline(host, placement, tile_mm)
    length = centerline.length_mm(tile_mm)
    if length <= 0.0:
        return []
    # 요청 간격을 폐곡선 길이의 정확한 약수로 스냅 — 랩 경계에서도 리듬 균일
    count, spacing = snap_spacing(length, placement.spacing_mm)
    cap = get_settings().max_placement_instances
    if count > cap:
        raise ValueError(
            f"path_following would place {count} instances (> max_placement_instances {cap})"
        )
    follow = placement.rotation == "follow_path"
    fixed_rotation = placement.fixed_rotation_deg or 0.0

    start = placement.phase_mm % length
    instances: list[Instance] = []
    k = 0
    while True:
        s = start + k * spacing
        if s >= length - _EPS:
            break
        (x, y), tangent = centerline.point_at(s, tile_mm)
        instances.append(Instance(x, y, tangent if follow else fixed_rotation))
        k += 1
    return instances


# ---- lattice ----


def place_lattice(placement: Placement, tile_mm: float) -> list[Instance]:
    spec = placement.lattice
    if spec is None:
        raise ValueError("lattice placement requires a `lattice` spec")
    cw, ch = spec.cell_w_mm, spec.cell_h_mm
    drop = spec.drop_fraction or 0.0
    cap = get_settings().max_placement_instances
    nx = lattice_axis_count(tile_mm, cw, cap)
    ny = lattice_axis_count(tile_mm, ch, cap)
    if nx * ny > cap:
        raise ValueError(
            f"lattice would place {nx * ny} instances (> max_placement_instances {cap})"
        )
    if spec.drop_axis == "column":
        b1 = (cw, ch * drop)
        b2 = (0.0, ch)
    else:
        b1 = (cw, 0.0)
        b2 = (cw * drop, ch)
    instances: list[Instance] = []
    for i in range(nx):
        for j in range(ny):
            x = i * b1[0] + j * b2[0]
            y = i * b1[1] + j * b2[1]
            instances.append(
                Instance(x % tile_mm, y % tile_mm, placement.fixed_rotation_deg or 0.0)
            )
    return instances


def lattice_axis_count(tile_mm: float, cell_mm: float, cap: int) -> int:
    """Bound one lattice axis without converting infinity to an integer."""
    ratio = tile_mm / cell_mm
    if not math.isfinite(ratio) or ratio > cap:
        return cap + 1
    return round(ratio)


# ---- scatter ----


def _torus_dist(ax: float, ay: float, bx: float, by: float, tile_mm: float) -> float:
    dx = abs(ax - bx)
    dy = abs(ay - by)
    dx = min(dx, tile_mm - dx)
    dy = min(dy, tile_mm - dy)
    return math.hypot(dx, dy)


def scatter_target_count(spec: ScatterSpec, tile_mm: float, cap: int) -> int:
    """Estimate scatter output without overflowing on an arbitrarily tiny min distance."""
    if spec.mode == "sateen":
        if spec.sateen_n is None:
            raise ValueError("sateen scatter placement requires `sateen_n`")
        return spec.sateen_n
    if spec.count is not None:
        return spec.count
    if spec.min_dist_mm is None:
        raise ValueError("poisson scatter placement requires `min_dist_mm`")
    ratio = tile_mm / spec.min_dist_mm
    threshold = math.sqrt((cap + 1) * _HEX_PACKING_FACTOR)
    if not math.isfinite(ratio) or ratio >= threshold:
        return cap + 1
    return max(1, int((ratio * ratio) / _HEX_PACKING_FACTOR))


def place_scatter(placement: Placement, tile_mm: float, seed: int) -> list[Instance]:
    spec = placement.scatter
    if spec is None:
        raise ValueError("scatter placement requires a `scatter` spec")
    if spec.mode == "sateen":
        if spec.sateen_n is None:
            raise ValueError("sateen scatter placement requires `sateen_n`")
        n = spec.sateen_n
        step = spec.sateen_step if spec.sateen_step is not None else 1
        cell = tile_mm / n
        return [
            Instance(
                i * cell,
                ((i * step) % n) * cell,
                placement.fixed_rotation_deg or 0.0,
            )
            for i in range(n)
        ]

    if spec.min_dist_mm is None:
        raise ValueError("poisson scatter placement requires `min_dist_mm`")
    min_dist = spec.min_dist_mm
    rng = random.Random(seed)
    cap = get_settings().max_placement_instances
    target = scatter_target_count(spec, tile_mm, cap)
    if target > cap:
        raise ValueError(
            f"scatter would place {target} instances (> max_placement_instances {cap})"
        )
    max_attempts = target * _ATTEMPTS_PER_TARGET

    pts: list[tuple[float, float]] = []
    # Cell width is >= min_dist, so only the 3x3 toroidal neighbor cells can contain a
    # conflicting point. This preserves the exact acceptance predicate and RNG order while
    # avoiding the previous O(attempts * accepted_points) scan.
    grid_n = max(1, int(tile_mm / min_dist))
    cell_size = tile_mm / grid_n
    grid: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for _ in range(max_attempts):
        x = rng.random() * tile_mm  # x 먼저, y 나중 — RNG 소비 순서 고정
        y = rng.random() * tile_mm
        cx = min(grid_n - 1, int(x / cell_size))
        cy = min(grid_n - 1, int(y / cell_size))
        neighbor_keys: list[tuple[int, int]] = []
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                key = ((cx + ox) % grid_n, (cy + oy) % grid_n)
                if key not in neighbor_keys:
                    neighbor_keys.append(key)
        neighbors = (point for key in neighbor_keys for point in grid.get(key, ()))
        if all(_torus_dist(x, y, px, py, tile_mm) >= min_dist for px, py in neighbors):
            pts.append((x, y))
            grid.setdefault((cx, cy), []).append((x, y))
            if len(pts) >= target:
                break
    return [Instance(x, y, placement.fixed_rotation_deg or 0.0) for x, y in pts]


# ---- point_set ----


def place_point_set(placement: Placement, tile_mm: float) -> list[Instance]:
    spec = placement.point_set
    if spec is None:
        raise ValueError("point_set placement requires a `point_set` spec")
    return [
        Instance(x % tile_mm, y % tile_mm, placement.fixed_rotation_deg or 0.0)
        for x, y in spec.points
    ]
