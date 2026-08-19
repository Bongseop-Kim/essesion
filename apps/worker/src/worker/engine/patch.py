"""구성 patch — 입력창 문장이 바꿀 수 있는 축만 담는 좁은 계약.

모티프 정체성 필드는 스키마에 **없다**. 모델이 모티프를 바꾸는 것은 타입상 불가능하므로
"요청하지 않은 걸 모델이 건드렸는지"를 사후에 정규식으로 추측하고 되돌리는 기계가 필요 없다.
모든 축은 nullable이고, null은 "그대로 둔다"는 뜻이다.

적용은 결정론(`apply_patch`)이다. 격자 셀은 tile을 나누는 값으로만 만들고, 밴드는 period
안으로 정규화하고, 모티프 크기는 tile로 클램프한다 — patch가 엔진 불변식을 깨는 intent를
만들 수 없으므로 자기수정 재시도 라운드가 없다.

모티프 정체성 교체(`set_motif_slot`)는 이 파일의 두 번째 축이다. 모델이 아니라 사용자가
고른 id를 그대로 넣는 결정론 연산이라 patch 스키마 밖에 둔다.
"""

from __future__ import annotations

import copy
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from worker.engine.constraints import (
    LATTICE_OVERLAP_ALLOWANCE,
    ConstraintInvalid,
    lattice_placement,
    normalize_hex,
    ordered_slot_refs,
    scatter_placement,
)
from worker.engine.units import snap_angle, stripe_tiles

Arrangement = Literal["lattice", "staggered", "scatter"]

MAX_PATCH_BANDS = 4
MIN_AXIS_COUNT = 2
MAX_AXIS_COUNT = 10
# tile_mm은 물리 치수가 아니라 화면 배율 캐리어다(2026-08-19 확정) — 이 SVG는 그대로
# 실물 출력에 들어가지 않는다. 프론트는 SVG 루트 width="Nmm"을 읽어 반복 배율을 비례시킨다.
BASE_TILE_MM = 48.0  # authoring compiler의 DEFAULT_TILE_MM과 같은 값 — 프론트 svgTileScale의 분모
SCALE_MIN, SCALE_MAX = 0.25, 4.0
# 누적 클램프 — dpi 고정이라 래스터 픽셀 수가 tile²로 는다(300dpi에서 192mm ≈ 2268px,
# fabric의 _MAX_INLAY_PIXELS 20M보다 한참 아래).
MIN_TILE_MM = BASE_TILE_MM * SCALE_MIN
MAX_TILE_MM = BASE_TILE_MM * SCALE_MAX
PATCH_AXES = (
    "background",
    "stripe",
    "placement",
    "motif_size_mm",
    "scale",
    "palette",
)


class _Patch(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PaletteSlotPatch(_Patch):
    id: str = Field(min_length=1, max_length=40)
    hex: str

    _normalize_hex = field_validator("hex")(staticmethod(normalize_hex))


class PalettePatch(_Patch):
    slots: list[PaletteSlotPatch] = Field(min_length=1, max_length=16)


class BackgroundPatch(_Patch):
    color: str

    _normalize_hex = field_validator("color")(staticmethod(normalize_hex))


class BandPatch(_Patch):
    offset_mm: float = Field(ge=0.0)
    width_mm: float = Field(gt=0.0)
    color: str

    _normalize_hex = field_validator("color")(staticmethod(normalize_hex))


class StripePatch(_Patch):
    angle: float | None = Field(default=None, ge=-360.0, le=360.0)
    period_mm: float | None = Field(default=None, gt=0.0)
    # 빈 배열은 "줄무늬를 없앤다"다. null은 밴드를 건드리지 않는다.
    bands: list[BandPatch] | None = Field(default=None, max_length=MAX_PATCH_BANDS)


class PlacementPatch(_Patch):
    arrangement: Arrangement | None = None
    count_per_axis: int | None = Field(default=None, ge=MIN_AXIS_COUNT, le=MAX_AXIS_COUNT)
    rotation_deg: float | None = Field(default=None, ge=-360.0, le=360.0)


class DesignPatchV1(_Patch):
    background: BackgroundPatch | None = None
    stripe: StripePatch | None = None
    placement: PlacementPatch | None = None
    # 모티프 레이어 순서대로. 남는 값은 무시한다(모델이 레이어 수를 세지 못해도 안전).
    motif_size_mm: list[float] | None = Field(default=None, max_length=2)
    # 전역 배율 — intent의 모든 길이(mm)를 tile_mm 포함해 일괄 f배. 균일 배율은 모든
    # seamless 불변식을 보존하므로 재스냅이 걸리지 않는다. motif_size_mm은 배율 적용
    # **후** 최종 프레임의 절대값으로 적용된다.
    scale: float | None = Field(default=None, ge=SCALE_MIN, le=SCALE_MAX)
    palette: PalettePatch | None = None
    note: str = Field(min_length=1, max_length=200)
    # 요청이 이 계약으로 표현할 수 없는 축(모티프 정체성 등)일 때만 true.
    out_of_scope: bool = False

    @property
    def changed_axes(self) -> list[str]:
        """실제로 바뀐 축 이름 — 거절 판정과 admin 진단이 같은 목록을 본다."""
        return [axis for axis in PATCH_AXES if getattr(self, axis) is not None]

    @property
    def has_changes(self) -> bool:
        return bool(self.changed_axes)


def _layers(raw: dict[str, Any], layer_type: str) -> list[dict[str, Any]]:
    layers = raw.get("layers")
    if not isinstance(layers, list):
        return []
    return [
        layer for layer in layers if isinstance(layer, dict) and layer.get("type") == layer_type
    ]


def _positive_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) and number > 0 else None


def _tile_mm(intent: dict[str, Any]) -> object:
    canvas = intent.get("canvas")
    return canvas.get("tile_mm") if isinstance(canvas, dict) else None


def _scale_field(host: dict[str, Any], key: str, factor: float) -> None:
    value = host.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        return
    scaled = float(value) * factor
    if math.isfinite(scaled):
        host[key] = round(scaled, 6)


def _effective_scale(tile: float, factor: float, warnings: list[str]) -> float:
    """누적 클램프 — 적용 후 tile이 [MIN, MAX]를 벗어나면 경계에 맞는 배율로 줄인다."""
    target = tile * factor
    clamped = min(max(target, MIN_TILE_MM), MAX_TILE_MM)
    if clamped == target:
        return factor
    effective = clamped / tile
    warnings.append(
        f"scale {factor:g} would push tile_mm to {target:g} (allowed "
        f"{MIN_TILE_MM:g}..{MAX_TILE_MM:g}); reduced to {effective:.4f}"
    )
    return effective


def _apply_scale(raw: dict[str, Any], factor: float, *, include_stripes: bool = True) -> None:
    """intent의 모든 길이(mm)를 일괄 f배 — 각도·비율·seed·dpi는 불변.

    균일 배율은 seamless 불변식(tile == k·period·hypot, divides(tile, cell),
    wave λ | closure, size ≤ tile)을 전부 보존한다. include_stripes=False는 off-grid
    period 백스톱용 — 줄무늬 params는 모델이 낸 값을 verbatim 유지해야 밴드별로 다르게
    낸 값이 살아남는다. 필드 목록은 engine.intent의 mm 단위 필드 전수와 대응한다.
    """
    canvas = raw.get("canvas")
    if isinstance(canvas, dict):
        _scale_field(canvas, "tile_mm", factor)
    if include_stripes:
        for layer in _layers(raw, "stripe"):
            params = layer.get("params")
            if not isinstance(params, dict):
                continue
            _scale_field(params, "period_mm", factor)
            for band in params.get("bands", []):
                if isinstance(band, dict):
                    _scale_field(band, "offset_mm", factor)
                    _scale_field(band, "width_mm", factor)
    for layer in _layers(raw, "motif"):
        params = layer.get("params")
        if isinstance(params, dict):
            _scale_field(params, "size_mm", factor)
        placement = layer.get("placement")
        if not isinstance(placement, dict):
            continue
        _scale_field(placement, "spacing_mm", factor)
        _scale_field(placement, "phase_mm", factor)
        path = placement.get("path")
        if isinstance(path, dict):
            _scale_field(path, "wavelength", factor)
            _scale_field(path, "amplitude", factor)
        lattice = placement.get("lattice")
        if isinstance(lattice, dict):
            for key in ("cell_w_mm", "cell_h_mm", "offset_x_mm", "offset_y_mm"):
                _scale_field(lattice, key, factor)
        scatter = placement.get("scatter")
        if isinstance(scatter, dict):
            _scale_field(scatter, "min_dist_mm", factor)
        point_set = placement.get("point_set")
        if isinstance(point_set, dict) and isinstance(point_set.get("points"), list):
            point_set["points"] = [
                [round(float(coord) * factor, 6) for coord in point]
                if isinstance(point, list | tuple)
                else point
                for point in point_set["points"]
            ]


def _axis_count(placement: dict[str, Any], tile: float) -> int | None:
    """격자·산개 배치의 축당 개수 — patch·스냅샷이 공유하는 단일 밀도 축."""

    spec = placement.get("lattice") if placement.get("type") == "lattice" else None
    if isinstance(spec, dict):
        cell = _positive_float(spec.get("cell_w_mm"))
        return max(MIN_AXIS_COUNT, round(tile / cell)) if cell else None
    spec = placement.get("scatter") if placement.get("type") == "scatter" else None
    if isinstance(spec, dict):
        distance = _positive_float(spec.get("min_dist_mm"))
        return max(MIN_AXIS_COUNT, round(tile / distance)) if distance else None
    return None


def _arrangement(placement: dict[str, Any]) -> Arrangement | None:
    if placement.get("type") == "scatter":
        return "scatter"
    if placement.get("type") != "lattice":
        return None
    spec = placement.get("lattice")
    staggered = isinstance(spec, dict) and spec.get("drop_fraction") is not None
    return "staggered" if staggered else "lattice"


def composition_snapshot(intent: dict[str, Any]) -> dict[str, Any]:
    """현재 구성을 patch와 같은 모양으로 — 모델은 바꿀 필드만 다시 쓴다.

    모티프 id·이름·정체성은 담지 않는다. 슬롯 hex는 컴파일러가 default colorway 매핑과
    같은 값으로 쓰므로 슬롯에서 읽는다.
    """

    tile = _positive_float(_tile_mm(intent)) or 0.0
    palette = intent.get("palette")
    slots = palette.get("slots") if isinstance(palette, dict) else None
    hex_by_id = {
        slot["id"]: slot["hex"]
        for slot in slots or []
        if isinstance(slot, dict) and isinstance(slot.get("id"), str)
    }
    roles: dict[str, list[str]] = {slot_id: [] for slot_id in hex_by_id}
    for role in ("background", "stripe"):
        for layer in _layers(intent, role):
            for slot_id in ordered_slot_refs({"layers": [layer]}):
                if slot_id in roles and role not in roles[slot_id]:
                    roles[slot_id].append(role)

    snapshot: dict[str, Any] = {
        "tile_mm": tile,
        # 고객용 note는 클램프 **전에** 쓰인다 — 잔여 여유를 미리 알려 안내 불일치를 줄인다.
        "scale": {
            "current": round(tile / BASE_TILE_MM, 6),
            "min": round(max(SCALE_MIN, MIN_TILE_MM / tile), 6),
            "max": round(min(SCALE_MAX, MAX_TILE_MM / tile), 6),
        }
        if tile > 0
        else None,
        "palette": {
            "slots": [
                {"id": slot_id, "hex": slot_hex, "roles": roles[slot_id]}
                for slot_id, slot_hex in hex_by_id.items()
            ]
        },
    }
    backgrounds = _layers(intent, "background")
    if backgrounds:
        slot_id = backgrounds[0].get("params", {}).get("color")
        snapshot["background"] = {"color": hex_by_id.get(slot_id, slot_id)}
    stripes = _layers(intent, "stripe")
    if stripes:
        params = stripes[0].get("params", {})
        snapshot["stripe"] = {
            "angle": params.get("angle"),
            "period_mm": params.get("period_mm"),
            "bands": [
                {
                    "offset_mm": band.get("offset_mm"),
                    "width_mm": band.get("width_mm"),
                    "color": hex_by_id.get(band.get("color"), band.get("color")),
                }
                for band in params.get("bands", [])
                if isinstance(band, dict)
            ],
        }
    motifs = _layers(intent, "motif")
    if motifs:
        placement = motifs[0].get("placement")
        placement = placement if isinstance(placement, dict) else {}
        snapshot["placement"] = {
            "arrangement": _arrangement(placement),
            "count_per_axis": _axis_count(placement, tile),
            "rotation_deg": placement.get("fixed_rotation_deg"),
        }
        snapshot["motif_size_mm"] = [layer.get("params", {}).get("size_mm") for layer in motifs]
    return snapshot


class _SlotBook:
    """patch의 hex를 팔레트 슬롯으로 결정론적으로 옮긴다."""

    def __init__(self, raw: dict[str, Any]) -> None:
        self._slots: list[dict[str, Any]] = raw["palette"]["slots"]
        self._colorways: list[dict[str, Any]] = raw["colorways"]

    def _map(self, slot_id: str, hex_value: str) -> None:
        for colorway in self._colorways:
            colorway["mapping"][slot_id] = hex_value

    def recolor(self, slot_id: str, hex_value: str) -> None:
        slot = next((slot for slot in self._slots if slot.get("id") == slot_id), None)
        if slot is None:
            raise ConstraintInvalid([f"unknown color slot {slot_id!r}"])
        slot["hex"] = hex_value
        slot.pop("spot", None)
        self._map(slot_id, hex_value)

    def slot_for(self, hex_value: str) -> str:
        for slot in self._slots:
            if str(slot.get("hex", "")).casefold() == hex_value.casefold():
                return str(slot["id"])
        taken = {str(slot.get("id")) for slot in self._slots}
        slot_id = next(
            candidate
            for index in range(len(taken) + 1, 100)
            if (candidate := f"color_{index}") not in taken
        )
        self._slots.append({"id": slot_id, "hex": hex_value})
        self._map(slot_id, hex_value)
        return slot_id


def _apply_stripe(
    raw: dict[str, Any],
    patch: StripePatch,
    *,
    tile: float,
    book: _SlotBook,
    warnings: list[str],
) -> None:
    layers: list[dict[str, Any]] = raw["layers"]
    stripes = _layers(raw, "stripe")
    if patch.bands is not None and not patch.bands:
        hosts = {str(layer.get("id")) for layer in stripes}
        hosted = [
            layer.get("id")
            for layer in layers
            if isinstance(layer.get("placement"), dict)
            and layer["placement"].get("host_layer") in hosts
        ]
        if hosted:
            raise ConstraintInvalid(
                [f"stripe layers host motif paths {hosted}; the motif placement must change first"]
            )
        layers[:] = [layer for layer in layers if layer.get("type") != "stripe"]
        return

    if not stripes:
        if not patch.bands:
            return
        period = patch.period_mm if patch.period_mm is not None else tile / 4
        params: dict[str, Any] = {
            "angle": patch.angle if patch.angle is not None else 0.0,
            "period_mm": round(period, 6),
            "bands": [],
        }
        target: dict[str, Any] = {
            "id": "stripe_0",
            "type": "stripe",
            "z_order": 1,
            "params": params,
        }
        # 배경 바로 위 — 모티프는 줄무늬 위에 남는다. z_order는 마지막에 다시 번호를 붙인다.
        insert_at = 1 if layers and layers[0].get("type") == "background" else 0
        layers.insert(insert_at, target)
    else:
        target = stripes[0]
        params = target["params"]
        if patch.angle is not None:
            params["angle"] = patch.angle
        if patch.period_mm is not None:
            # off-grid 백스톱: period를 스냅하지 않고 tile을 배율한다 — 모델이 scale 대신
            # period로 확대를 표현해도 요청이 조용히 원복(validate의 재스냅)되지 않는다.
            # 줄무늬 params는 verbatim 유지("빨간 밴드만 1.5배" 같은 밴드별 값이 살아남는다),
            # 나머지는 f = 요청/현재 배로 함께 커져 새 tile에서 요청 period가 같은 k로
            # on-grid가 된다. 클램프로 f가 줄면 validate의 재스냅이 최후 방어선.
            snapped = snap_angle(float(params["angle"]))
            current = _positive_float(params.get("period_mm"))
            if current and not stripe_tiles(tile, patch.period_mm, snapped.p, snapped.q):
                factor = _effective_scale(tile, patch.period_mm / current, warnings)
                if factor != 1.0:
                    _apply_scale(raw, factor, include_stripes=False)
                    tile = round(tile * factor, 6)
            params["period_mm"] = round(patch.period_mm, 6)

    if patch.bands:
        params["bands"] = [
            {
                "offset_mm": band.offset_mm,
                "width_mm": band.width_mm,
                "color": book.slot_for(band.color),
            }
            for band in patch.bands
        ]
    # 밴드는 항상 최종 period 안에 있어야 한다 — 새 밴드든, period만 바뀐 기존 밴드든.
    period = float(params["period_mm"])
    for band in params["bands"]:
        band["offset_mm"] = round(float(band["offset_mm"]) % period, 6)
        band["width_mm"] = round(min(float(band["width_mm"]), period), 6)


def _cell_offset_fraction(placement: dict[str, Any]) -> tuple[float, float]:
    """격자 위상을 셀 대비 비율로 — 두 모티프 슬롯이 엇갈린 정도(`set_motif_slot`)다."""

    spec = placement.get("lattice") if placement.get("type") == "lattice" else None
    if not isinstance(spec, dict):
        return (0.0, 0.0)
    cell_w = _positive_float(spec.get("cell_w_mm"))
    cell_h = _positive_float(spec.get("cell_h_mm"))
    if cell_w is None or cell_h is None:
        return (0.0, 0.0)
    offset_x = spec.get("offset_x_mm")
    offset_y = spec.get("offset_y_mm")
    return (
        (float(offset_x) / cell_w) if isinstance(offset_x, int | float) else 0.0,
        (float(offset_y) / cell_h) if isinstance(offset_y, int | float) else 0.0,
    )


def _density_cap(raw: dict[str, Any], tile: float) -> int:
    """현재 모티프 크기가 셀에 들어가는 최대 축 개수 — 크기 대신 밀도를 양보한다.

    `constraints._clamp_lattice_overlap`이 줄인 크기는 셀을 되돌려도 복구되지 않으므로,
    크기를 안 건드린 patch에서는 밀도를 낮춰 크기를 지킨다. 크기는 사용자가 명시한 축이고
    밀도는 "촘촘/넓게"라는 상대 표현이다.
    """

    sizes = [
        size
        for layer in _layers(raw, "motif")
        if isinstance(layer.get("params"), dict)
        and (size := _positive_float(layer["params"].get("size_mm"))) is not None
    ]
    if not sizes:
        return MAX_AXIS_COUNT
    fits = int(tile * LATTICE_OVERLAP_ALLOWANCE / max(sizes))
    return max(MIN_AXIS_COUNT, min(MAX_AXIS_COUNT, fits))


def _apply_placement(
    raw: dict[str, Any],
    patch: PlacementPatch,
    *,
    tile: float,
    cap: int = MAX_AXIS_COUNT,
) -> None:
    for layer in _layers(raw, "motif"):
        placement = layer.get("placement")
        placement = dict(placement) if isinstance(placement, dict) else {}
        # 배치를 새로 만들면 위상이 0으로 돌아가 두 모티프가 정확히 포개진다 — 비율로 옮긴다.
        offset_fraction = _cell_offset_fraction(placement)
        rotation = (
            patch.rotation_deg
            if patch.rotation_deg is not None
            else placement.get("fixed_rotation_deg")
        )
        arrangement = patch.arrangement
        count = patch.count_per_axis or _axis_count(placement, tile) or 6
        if arrangement is None and patch.count_per_axis is not None:
            arrangement = _arrangement(placement)
        if arrangement == "scatter":
            placement = scatter_placement(
                tile=tile, axis=count, count=max(4, round(count * count * 0.5))
            )
        elif arrangement is not None:
            staggered = arrangement == "staggered"
            # 엇갈림은 홀수 축을 올림하므로 상한도 짝수로 내린다 — 올림이 셀을 상한 밑으로 민다.
            limit = cap - cap % 2 if staggered else cap
            placement = lattice_placement(tile=tile, count=min(count, limit), staggered=staggered)
            spec = placement["lattice"]
            if any(offset_fraction):
                spec["offset_x_mm"] = round(offset_fraction[0] * spec["cell_w_mm"], 6)
                spec["offset_y_mm"] = round(offset_fraction[1] * spec["cell_h_mm"], 6)
        elif patch.count_per_axis is not None and placement.get("type") == "path_following":
            placement["spacing_mm"] = round(tile / count, 6)
        if rotation is not None:
            placement["fixed_rotation_deg"] = rotation
            if placement.get("type") == "path_following":
                placement["rotation"] = "fixed"
        layer["placement"] = placement


def apply_patch(
    intent: dict[str, Any], patch: DesignPatchV1, *, warnings: list[str] | None = None
) -> dict[str, Any]:
    """patch를 적용한 새 intent를 돌려준다 — 호출부의 intent는 건드리지 않는다.

    적용 순서: scale(또는 off-grid period 백스톱)이 tile 프레임을 먼저 확정하고,
    motif_size_mm은 그 뒤 최종 프레임의 절대값으로 적용된다 — "줄무늬 굵게 + 모티프는
    그대로"를 scale + motif_size_mm=[현재값]으로 표현할 수 있다.
    """

    warnings = warnings if warnings is not None else []
    raw = copy.deepcopy(intent)
    tile = _positive_float(_tile_mm(raw))
    palette = raw.get("palette")
    if tile is None:
        raise ConstraintInvalid(["intent requires a positive canvas.tile_mm"])
    if (
        not isinstance(raw.get("layers"), list)
        or not isinstance(raw.get("colorways"), list)
        or not isinstance(palette, dict)
        or not isinstance(palette.get("slots"), list)
    ):
        raise ConstraintInvalid(["intent requires palette.slots, layers, and colorways"])
    book = _SlotBook(raw)

    if patch.scale is not None:
        factor = _effective_scale(tile, patch.scale, warnings)
        if factor != 1.0:
            _apply_scale(raw, factor)
            tile = _positive_float(_tile_mm(raw)) or tile
    if patch.palette is not None:
        for slot in patch.palette.slots:
            book.recolor(slot.id, slot.hex)
    if patch.background is not None:
        backgrounds = _layers(raw, "background")
        if backgrounds:
            ground = backgrounds[0]
            slot_id = ground["params"]["color"]
            shared = any(
                slot_id in ordered_slot_refs({"layers": [layer]})
                for layer in raw["layers"]
                if layer is not ground
            )
            # 다른 팔레트 레이어와 슬롯을 공유하면 배경만 떼어낸다.
            if shared:
                ground["params"]["color"] = book.slot_for(patch.background.color)
            else:
                book.recolor(slot_id, patch.background.color)
    if patch.stripe is not None:
        _apply_stripe(raw, patch.stripe, tile=tile, book=book, warnings=warnings)
        # off-grid period 백스톱이 tile을 배율했을 수 있다
        tile = _positive_float(_tile_mm(raw)) or tile
    if patch.placement is not None:
        # 밀도 양보는 크기를 안 건드린 patch만 — 둘 다 바꾼 patch는 지금처럼 크기를 클램프한다.
        cap = MAX_AXIS_COUNT if patch.motif_size_mm is not None else _density_cap(raw, tile)
        _apply_placement(raw, patch.placement, tile=tile, cap=cap)
    if patch.motif_size_mm is not None:
        for layer, size in zip(_layers(raw, "motif"), patch.motif_size_mm, strict=False):
            requested = _positive_float(size)
            if requested is not None:
                layer["params"]["size_mm"] = round(min(requested, tile), 6)
    _renumber(raw)
    return raw


# ---- 모티프 슬롯 교체 ----
#
# patch와 달리 여기 들어오는 모티프 id는 모델이 아니라 사용자가 고른 값이다. 모델 호출이
# 없으므로 같은 (intent, slot, motif_id)는 항상 같은 intent를 만든다.

MAX_MOTIF_SLOTS = 2


def _derived_placement(placement: dict[str, Any], tile: float) -> dict[str, Any]:
    """기존 레이어의 배치에서 파생한, 반 칸 엇갈린 배치.

    격자면 셀을 그대로 쓰고 위상만 옮긴다. 그 밖의 배치(산개·점집합·경로)는 축 개수만
    물려받아 격자로 내린다 — 같은 seed의 산개를 복제하면 두 모티프가 정확히 겹친다.
    """

    if placement.get("type") == "lattice" and isinstance(placement.get("lattice"), dict):
        derived = copy.deepcopy(placement)
        spec = derived["lattice"]
    else:
        count = _axis_count(placement, tile) or 6
        derived = lattice_placement(tile=tile, count=count, staggered=False)
        spec = derived["lattice"]
        if placement.get("fixed_rotation_deg") is not None:
            derived["fixed_rotation_deg"] = placement["fixed_rotation_deg"]
    spec["offset_x_mm"] = round(float(spec["cell_w_mm"]) / 2, 6)
    spec["offset_y_mm"] = round(float(spec["cell_h_mm"]) / 2, 6)
    return derived


def _first_motif_layer(raw: dict[str, Any], tile: float, motif_id: str) -> dict[str, Any]:
    """모티프가 없던 디자인의 첫 레이어."""

    return {
        "id": _free_layer_id(raw, "motif_slot_1"),
        "type": "motif",
        "z_order": len(raw["layers"]),
        "params": {"motif_id": motif_id, "size_mm": round(tile * 0.18, 6)},
        "placement": lattice_placement(tile=tile, count=6, staggered=False),
    }


def set_motif_slot(intent: dict[str, Any], *, slot: int, motif_id: str) -> dict[str, Any]:
    """슬롯(1..2)의 모티프 id만 바꾼 새 intent — 없는 슬롯은 레이어를 파생해 만든다.

    모티프가 하나도 없는 디자인은 어느 슬롯을 요청해도 첫 레이어를 만든다 — 빈 슬롯 2만
    따로 만들면 슬롯 1이 영구히 비어 UI가 채울 방법이 없다.
    """

    if not 1 <= slot <= MAX_MOTIF_SLOTS:
        raise ConstraintInvalid([f"motif slot must be 1..{MAX_MOTIF_SLOTS}"])
    raw = copy.deepcopy(intent)
    tile = _positive_float(_tile_mm(raw))
    palette = raw.get("palette")
    if (
        tile is None
        or not isinstance(raw.get("layers"), list)
        or not isinstance(raw.get("colorways"), list)
        or not isinstance(palette, dict)
        or not isinstance(palette.get("slots"), list)
    ):
        raise ConstraintInvalid(["intent requires palette.slots, layers, and colorways"])
    motifs = _layers(raw, "motif")
    if not motifs:
        # 줄무늬·단색만 있는 디자인의 첫 무늬 — 파생할 레이어가 없으니 기본 격자로 시작한다.
        raw["layers"].append(_first_motif_layer(raw, tile, motif_id))
        _renumber(raw)
        return raw
    source = motifs[min(slot, len(motifs)) - 1]
    if not isinstance(source.get("params"), dict):
        raise ConstraintInvalid(["motif layer is missing params"])
    if slot <= len(motifs):
        source["params"]["motif_id"] = motif_id
        return raw

    placement = source.get("placement")
    derived = copy.deepcopy(source)
    derived["id"] = _free_layer_id(raw, f"motif_slot_{slot}")
    derived["params"]["motif_id"] = motif_id
    derived["placement"] = _derived_placement(
        placement if isinstance(placement, dict) else {}, tile
    )
    raw["layers"].append(derived)
    _renumber(raw)
    return raw


def _free_layer_id(raw: dict[str, Any], base: str) -> str:
    taken = {str(layer.get("id")) for layer in raw["layers"] if isinstance(layer, dict)}
    candidate, index = base, 2
    while candidate in taken:
        candidate, index = f"{base}_{index}", index + 1
    return candidate


def _renumber(raw: dict[str, Any]) -> None:
    """참조가 끊긴 슬롯 제거 + z_order 재부여 — 편집이 쌓여도 팔레트가 커지지 않고,
    colorway는 선언 슬롯 전부를 정확히 매핑해야 한다(engine.palette 불변식)."""
    referenced = set(ordered_slot_refs(raw))
    slots = raw["palette"]["slots"]
    kept = [slot for slot in slots if slot.get("id") in referenced]
    if kept:
        slots[:] = kept
        for colorway in raw["colorways"]:
            colorway["mapping"] = {
                slot_id: value
                for slot_id, value in colorway["mapping"].items()
                if slot_id in referenced
            }
    for index, layer in enumerate(raw["layers"]):
        layer["z_order"] = index
