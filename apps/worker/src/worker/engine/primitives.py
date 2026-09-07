"""background/stripe 프리미티브 — 렌더 + stripe lanes() 계약 (worker-engine.md §2·§3)."""

import html
import math
from collections.abc import Sequence
from dataclasses import dataclass

from worker.config import get_settings
from worker.engine.host import Centerline, LaneField
from worker.engine.intent import Layer, StripeParams
from worker.engine.palette import Palette
from worker.engine.units import SnappedAngle, fmt, snap_angle


def escape_attr(value: object) -> str:
    return html.escape(str(value))


@dataclass(frozen=True)
class Background:
    color_slot: str

    def render(self, tile_mm: float, palette: Palette, colorway_id: str | None = None) -> str:
        fill = escape_attr(palette.resolve_color(self.color_slot, colorway_id))
        side = fmt(tile_mm)
        return f'<rect x="0" y="0" width="{side}" height="{side}" fill="{fill}"/>'


def band_gaps(bands: Sequence[tuple[float, float]], period: float) -> list[tuple[float, float]]:
    """밴드 i의 끝에서 **공간상** 다음 밴드 시작까지 (start, end). 원래 인덱스 순으로 돌려준다.

    밴드 목록은 offset 순이 아닐 수 있어 정렬해서 이웃을 찾는다. 마지막 밴드의 다음은 다음
    period의 첫 밴드. 맞붙거나 겹치면 end <= start다.
    """
    order = sorted(range(len(bands)), key=lambda i: bands[i][0])
    gaps: list[tuple[float, float]] = [(0.0, 0.0)] * len(bands)
    for rank, i in enumerate(order):
        offset, width = bands[i]
        following_offset = bands[order[(rank + 1) % len(order)]][0]
        if rank == len(order) - 1:
            following_offset += period
        gaps[i] = (offset + width, following_offset)
    return gaps


def build_stripe(params: StripeParams, tile_mm: float) -> "Stripe":
    return Stripe(params=params, tile_mm=tile_mm, snapped=snap_angle(params.angle))


def stripe_line_count(params: StripeParams, tile_mm: float, *, cap: int | None = None) -> int:
    """Return the exact number of SVG lines a stripe render would allocate."""
    snapped = snap_angle(params.angle)
    a = math.radians(snapped.angle_deg)
    nx, ny = -math.sin(a), math.cos(a)
    projections = (0.0, tile_mm * nx, tile_mm * ny, tile_mm * (nx + ny))
    lo, hi = min(projections), max(projections)
    total = 0
    for band in params.bands:
        center = band.offset_mm + band.width_mm / 2.0
        lower = (lo - center) / params.period_mm
        upper = (hi - center) / params.period_mm
        if not (math.isfinite(lower) and math.isfinite(upper)):
            return (cap + 1) if cap is not None else 10**100
        k_min = math.floor(lower)
        k_max = math.ceil(upper)
        total += k_max - k_min + 1
        if cap is not None and total > cap:
            return total
    return total


@dataclass(frozen=True)
class Stripe:
    params: StripeParams
    tile_mm: float
    snapped: SnappedAngle

    def render(self, palette: Palette, colorway_id: str | None = None) -> str:
        """스냅된 각도의 평행 밴드를 stroke된 중심선으로 반복 렌더.

        타일 꼭짓점들의 법선 투영 범위 [lo, hi]를 period로 나눠 k 범위를 정하고,
        각 밴드 중심선(offset + width/2)을 k·period만큼 평행 이동해 그린다.
        """
        cap = get_settings().max_placement_instances
        line_count = stripe_line_count(self.params, self.tile_mm, cap=cap)
        if line_count > cap:
            raise ValueError(
                f"stripe would render {line_count} lines (> max_placement_instances {cap})"
            )

        angle = self.snapped.angle_deg
        a = math.radians(angle)
        dx, dy = math.cos(a), math.sin(a)
        nx, ny = -math.sin(a), math.cos(a)
        tile = self.tile_mm
        half_len = tile * 2.0
        projections = (0.0, tile * nx, tile * ny, tile * (nx + ny))
        lo, hi = min(projections), max(projections)
        period = self.params.period_mm

        parts: list[str] = []
        for band in self.params.bands:
            fill = escape_attr(palette.resolve_color(band.color, colorway_id))
            width = fmt(band.width_mm)
            center = band.offset_mm + band.width_mm / 2.0
            k_min = math.floor((lo - center) / period)
            k_max = math.ceil((hi - center) / period)
            for k in range(k_min, k_max + 1):
                offset = center + k * period
                cx, cy = offset * nx, offset * ny
                x1, y1 = cx - half_len * dx, cy - half_len * dy
                x2, y2 = cx + half_len * dx, cy + half_len * dy
                parts.append(
                    f'<line x1="{fmt(x1)}" y1="{fmt(y1)}" '
                    f'x2="{fmt(x2)}" y2="{fmt(y2)}" '
                    f'stroke="{fill}" stroke-width="{width}"/>'
                )
        return f"<g>{''.join(parts)}</g>"

    def lanes(self) -> list[LaneField]:
        """밴드별 start/center/end와 다음 밴드까지의 빈 공간 가운데(gap)를 lane으로 노출.

        단일 밴드 stripe는 bare 키워드(start/center/end/gap)도 lane id로 등록한다.
        `b{i}.gap`은 밴드 i의 끝과 다음 밴드(마지막이면 다음 period의 첫 밴드) 시작 사이
        중점이다 — "줄 사이에 놓아줘"(2026-09-07 S1)를 표현하는 유일한 lane이다.
        """
        p, q = self.snapped.p, self.snapped.q
        angle = self.snapped.angle_deg
        bands = self.params.bands
        single = len(bands) == 1
        period = self.params.period_mm

        gaps = band_gaps([(band.offset_mm, band.width_mm) for band in bands], period)
        lanes: list[LaneField] = []
        for i, band in enumerate(bands):
            edges = {
                "start": band.offset_mm,
                "center": band.offset_mm + band.width_mm / 2.0,
                "end": band.offset_mm + band.width_mm,
            }
            gap_start, gap_end = gaps[i]
            # 맞붙은 밴드 사이엔 빈 공간이 없다 — gap lane을 내지 않아 between_stripes가 거절된다.
            if gap_end > gap_start:
                edges["gap"] = (gap_start + gap_end) / 2.0
            for name, offset in edges.items():
                centerline = Centerline(angle_deg=angle, offset_mm=offset, p=p, q=q)
                lanes.append(LaneField(id=f"b{i}.{name}", centerline_path=centerline))
                if single:
                    lanes.append(LaneField(id=name, centerline_path=centerline))
        return lanes


def build_primitive(layer: Layer, tile_mm: float):
    if layer.type == "background":
        return Background(color_slot=layer.params.color)
    if layer.type == "stripe":
        return build_stripe(layer.params, tile_mm)
    raise ValueError(f"unsupported primitive layer type: {layer.type!r}")
