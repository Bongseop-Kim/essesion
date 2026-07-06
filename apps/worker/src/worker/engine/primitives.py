"""background/stripe 프리미티브 — 렌더 + stripe lanes() 계약 (worker-engine.md §2·§3)."""

import html
import math
from dataclasses import dataclass

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


def build_stripe(params: StripeParams, tile_mm: float) -> "Stripe":
    return Stripe(params=params, tile_mm=tile_mm, snapped=snap_angle(params.angle))


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
        """밴드별 leading/center/trailing edge를 lane으로 노출.

        단일 밴드 stripe는 bare 키워드(start/center/end)도 lane id로 등록한다.
        """
        p, q = self.snapped.p, self.snapped.q
        angle = self.snapped.angle_deg
        period = self.params.period_mm
        single = len(self.params.bands) == 1

        lanes: list[LaneField] = []
        for i, band in enumerate(self.params.bands):
            edges = {
                "start": band.offset_mm,
                "center": band.offset_mm + band.width_mm / 2.0,
                "end": band.offset_mm + band.width_mm,
            }
            for name, offset in edges.items():
                centerline = Centerline(angle_deg=angle, offset_mm=offset, p=p, q=q)
                lanes.append(
                    LaneField(
                        id=f"b{i}.{name}",
                        centerline_path=centerline,
                        spacing_mm=period,
                        phase_mm=0.0,
                    )
                )
                if single:
                    lanes.append(
                        LaneField(
                            id=name,
                            centerline_path=centerline,
                            spacing_mm=period,
                            phase_mm=0.0,
                        )
                    )
        return lanes


def build_primitive(layer: Layer, tile_mm: float):
    if layer.type == "background":
        return Background(color_slot=layer.params.color)
    if layer.type == "stripe":
        return build_stripe(layer.params, tile_mm)
    raise ValueError(f"unsupported primitive layer type: {layer.type!r}")
