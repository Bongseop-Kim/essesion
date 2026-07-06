"""팔레트·컬러 슬롯·colorway (worker-engine.md §6).

슬롯 hex는 프리뷰용 비권위 — 출력색은 항상 활성 colorway 매핑으로 해석.
`default` colorway 필수, 각 colorway는 선언 슬롯 전부를 정확히 매핑.
"""

import colorsys
import re
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

DEFAULT_COLORWAY_ID = "default"

_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def is_hex_color(value: str) -> bool:
    return bool(_HEX.match(value))


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    h = value.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def out_of_gamut(hex_color: str) -> bool:
    """CMYK/스팟 색역 밖일 가능성이 큰 순색 고채도 sRGB 휴리스틱 — 경고 전용."""
    if not is_hex_color(hex_color):
        return False
    r, g, b = hex_to_rgb(hex_color)
    _, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return s > 0.95 and v > 0.9


@dataclass(frozen=True)
class ColorSlot:
    id: str
    hex: str
    spot: str | None = None
    name: str | None = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("color slot id must be non-empty")
        if not is_hex_color(self.hex):
            raise ValueError(f"invalid hex color: {self.hex!r}")


@dataclass(frozen=True)
class Colorway:
    id: str
    mapping: Mapping[str, str]
    name: str | None = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("colorway id must be non-empty")
        if not self.mapping:
            raise ValueError("colorway mapping must not be empty")
        object.__setattr__(self, "mapping", MappingProxyType(dict(self.mapping)))

    def color_for(self, slot_id: str) -> str:
        try:
            return self.mapping[slot_id]
        except KeyError:
            raise ValueError(f"colorway {self.id!r} has no mapping for slot {slot_id!r}") from None


@dataclass(frozen=True)
class Palette:
    slots: tuple[ColorSlot, ...]
    colorways: tuple[Colorway, ...]

    def __post_init__(self) -> None:
        if not self.slots:
            raise ValueError("palette must have at least one color slot")
        slot_ids = [s.id for s in self.slots]
        if len(slot_ids) != len(set(slot_ids)):
            raise ValueError("duplicate color slot id")
        cw_ids = [c.id for c in self.colorways]
        if len(cw_ids) != len(set(cw_ids)):
            raise ValueError("duplicate colorway id")
        if DEFAULT_COLORWAY_ID not in cw_ids:
            raise ValueError(f"a {DEFAULT_COLORWAY_ID!r} colorway is required")
        known = set(slot_ids)
        for cw in self.colorways:
            unknown = set(cw.mapping) - known
            if unknown:
                raise ValueError(f"colorway {cw.id!r} maps unknown slots: {sorted(unknown)}")
            missing = known - set(cw.mapping)
            if missing:
                raise ValueError(f"colorway {cw.id!r} missing slots: {sorted(missing)}")

    def slot_ids(self) -> set[str]:
        return {s.id for s in self.slots}

    def colorway(self, colorway_id: str | None) -> Colorway:
        target = colorway_id or DEFAULT_COLORWAY_ID
        for cw in self.colorways:
            if cw.id == target:
                return cw
        raise ValueError(f"unknown colorway: {colorway_id!r}")

    def resolve_color(self, slot_id: str, colorway_id: str | None = None) -> str:
        if slot_id not in self.slot_ids():
            raise ValueError(f"unknown color slot: {slot_id!r}")
        return self.colorway(colorway_id).color_for(slot_id)

    def distinct_colors(self, colorway_id: str | None = None) -> set[str]:
        cw = self.colorway(colorway_id)
        return {cw.color_for(s.id) for s in self.slots}
