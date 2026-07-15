"""호스트 lane 기하 계약 — Centerline(직선/wave)·LaneField (worker-engine.md §3)."""

import math
from dataclasses import dataclass
from typing import Literal

Point = tuple[float, float]


@dataclass(frozen=True)
class Centerline:
    """호 길이로 파라미터화된 토러스 주기 lane 중심선.

    straight는 (angle_deg, offset_mm)로 정의되고 스냅된 기울기 (p, q)가 폐곡선
    길이를 준다. wave는 법선 방향 사인파를 더하며 follow_path가 소비할 접선을
    도함수로 계산한다. 값은 raw float — fmt는 직렬화 경계의 몫.
    """

    angle_deg: float
    offset_mm: float
    p: int = 0
    q: int = 1
    kind: Literal["straight", "wave"] = "straight"
    wavelength_mm: float | None = None
    amplitude_mm: float | None = None

    def length_mm(self, tile_mm: float) -> float:
        return tile_mm * math.hypot(self.p, self.q)

    def point_at(self, s_mm: float, tile_mm: float) -> tuple[Point, float]:
        a = math.radians(self.angle_deg)
        dx, dy = math.cos(a), math.sin(a)
        nx, ny = -math.sin(a), math.cos(a)
        x = self.offset_mm * nx + s_mm * dx
        y = self.offset_mm * ny + s_mm * dy
        if self.kind == "straight":
            return (x % tile_mm, y % tile_mm), self.angle_deg
        # kind == "wave" (Literal["straight", "wave"]의 나머지 분기)
        if self.wavelength_mm is None or self.amplitude_mm is None:
            raise ValueError("wave centerline requires wavelength_mm and amplitude_mm")
        w = 2.0 * math.pi / self.wavelength_mm
        perp = self.amplitude_mm * math.sin(w * s_mm)
        perp_prime = self.amplitude_mm * w * math.cos(w * s_mm)
        x += perp * nx
        y += perp * ny
        vx = dx + perp_prime * nx
        vy = dy + perp_prime * ny
        tangent = math.degrees(math.atan2(vy, vx))
        return (x % tile_mm, y % tile_mm), tangent


@dataclass(frozen=True)
class LaneField:
    id: str
    centerline_path: Centerline


def resolve_lane(lanes: list[LaneField], key: str) -> LaneField:
    for lane in lanes:
        if lane.id == key:
            return lane
    available = ", ".join(lane.id for lane in lanes)
    raise ValueError(f"unknown lane {key!r}; available: {available}")
