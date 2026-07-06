"""placement 4종 — 토러스 좌표의 인스턴스 생성 (worker-engine.md §3).

scatter poisson만 RNG를 소비한다(시도당 x, y 정확히 2회 — 회전은 항상 0).
"""

import math
from dataclasses import dataclass

from worker.config import get_settings
from worker.engine.determinism import seeded_rng
from worker.engine.host import Centerline, HostLayer, resolve_lane
from worker.engine.intent import MotifLayer, PathSpec, Placement
from worker.engine.units import snap_angle, snap_spacing

_EPS = 1e-9
_ATTEMPTS_PER_TARGET = 30
_HEX_PACKING_FACTOR = math.sqrt(3) / 2


@dataclass(frozen=True)
class Instance:
    x_mm: float
    y_mm: float
    rotation_deg: float


def place(layer: MotifLayer, host: HostLayer | None, tile_mm: float, seed: int) -> list[Instance]:
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


def _resolve_centerline(host: HostLayer | None, placement: Placement, tile_mm: float) -> Centerline:
    if placement.path is not None and placement.host_layer is None:
        return _centerline_from_path(placement.path, tile_mm)
    if placement.lane is None:
        raise ValueError("path_following placement requires `lane` (or a standalone `path`)")
    if host is None:
        raise ValueError("path_following placement requires a host layer for `lane`")
    return resolve_lane(host.lanes(), placement.lane).centerline_path


def place_path_following(
    host: HostLayer | None, placement: Placement, tile_mm: float
) -> list[Instance]:
    if placement.spacing_mm is None:
        raise ValueError("path_following placement requires `spacing_mm`")
    centerline = _resolve_centerline(host, placement, tile_mm)
    length = centerline.length_mm(tile_mm)
    if length <= 0.0:
        return []
    # 요청 간격을 폐곡선 길이의 정확한 약수로 스냅 — 랩 경계에서도 리듬 균일
    _, spacing = snap_spacing(length, placement.spacing_mm)
    follow = placement.rotation == "follow_path"

    start = placement.phase_mm % length
    instances: list[Instance] = []
    k = 0
    while True:
        s = start + k * spacing
        if s >= length - _EPS:
            break
        (x, y), tangent = centerline.point_at(s, tile_mm)
        instances.append(Instance(x, y, tangent if follow else 0.0))
        k += 1
    return instances


# ---- lattice ----


def place_lattice(placement: Placement, tile_mm: float) -> list[Instance]:
    spec = placement.lattice
    if spec is None:
        raise ValueError("lattice placement requires a `lattice` spec")
    cw, ch = spec.cell_w_mm, spec.cell_h_mm
    drop = spec.drop_fraction or 0.0
    nx = round(tile_mm / cw)
    ny = round(tile_mm / ch)
    cap = get_settings().max_placement_instances
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
            instances.append(Instance(x % tile_mm, y % tile_mm, 0.0))
    return instances


# ---- scatter ----


def _torus_dist(ax: float, ay: float, bx: float, by: float, tile_mm: float) -> float:
    dx = abs(ax - bx)
    dy = abs(ay - by)
    dx = min(dx, tile_mm - dx)
    dy = min(dy, tile_mm - dy)
    return math.hypot(dx, dy)


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
        return [Instance(i * cell, ((i * step) % n) * cell, 0.0) for i in range(n)]

    if spec.min_dist_mm is None:
        raise ValueError("poisson scatter placement requires `min_dist_mm`")
    min_dist = spec.min_dist_mm
    rng = seeded_rng(seed)
    capacity = max(1, int((tile_mm * tile_mm) / (min_dist * min_dist * _HEX_PACKING_FACTOR)))
    target = spec.count if spec.count is not None else capacity
    max_attempts = target * _ATTEMPTS_PER_TARGET

    pts: list[tuple[float, float]] = []
    for _ in range(max_attempts):
        x = rng.random() * tile_mm  # x 먼저, y 나중 — RNG 소비 순서 고정
        y = rng.random() * tile_mm
        if all(_torus_dist(x, y, px, py, tile_mm) >= min_dist for px, py in pts):
            pts.append((x, y))
            if len(pts) >= target:
                break
    return [Instance(x, y, 0.0) for x, y in pts]


# ---- point_set ----


def place_point_set(placement: Placement, tile_mm: float) -> list[Instance]:
    spec = placement.point_set
    if spec is None:
        raise ValueError("point_set placement requires a `point_set` spec")
    return [Instance(x % tile_mm, y % tile_mm, 0.0) for x, y in spec.points]
