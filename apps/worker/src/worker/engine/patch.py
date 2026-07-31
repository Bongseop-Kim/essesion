"""구성 patch — 입력창 문장이 바꿀 수 있는 축만 담는 좁은 계약.

모티프 정체성 필드는 스키마에 **없다**. 모델이 모티프를 바꾸는 것은 타입상 불가능하므로
"요청하지 않은 걸 모델이 건드렸는지"를 사후에 정규식으로 추측하고 되돌리는 기계가 필요 없다.
모든 축은 nullable이고, null은 "그대로 둔다"는 뜻이다.

적용은 결정론(`apply_patch`)이다. 격자 셀은 tile을 나누는 값으로만 만들고, 밴드는 period
안으로 정규화하고, 모티프 크기는 tile로 클램프한다 — patch가 엔진 불변식을 깨는 intent를
만들 수 없으므로 자기수정 재시도 라운드가 없다.
"""

from __future__ import annotations

import copy
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from worker.engine.constraints import (
    ConstraintInvalid,
    PaletteConstraint,
    lattice_placement,
    normalize_hex,
    ordered_slot_refs,
    scatter_placement,
)

Arrangement = Literal["lattice", "staggered", "scatter"]

MAX_PATCH_BANDS = 4
MIN_AXIS_COUNT = 2
MAX_AXIS_COUNT = 10


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
    # 무늬 전체를 이 색으로 칠한다. 원본색을 유지하던 여러 색 무늬도 여기서 단색이 된다.
    motif_color: str | None = None
    palette: PalettePatch | None = None

    _normalize_motif_color = field_validator("motif_color")(
        staticmethod(lambda value: None if value is None else normalize_hex(value))
    )
    note: str = Field(min_length=1, max_length=200)
    # 요청이 이 계약으로 표현할 수 없는 축(모티프 정체성 등)일 때만 true.
    out_of_scope: bool = False

    @property
    def has_changes(self) -> bool:
        return any(
            value is not None
            for value in (
                self.background,
                self.stripe,
                self.placement,
                self.motif_size_mm,
                self.motif_color,
                self.palette,
            )
        )


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
    for role in ("background", "stripe", "motif"):
        for layer in _layers(intent, role):
            for slot_id in ordered_slot_refs({"layers": [layer]}):
                if slot_id in roles and role not in roles[slot_id]:
                    roles[slot_id].append(role)

    snapshot: dict[str, Any] = {
        "tile_mm": tile,
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
        # 여러 색 무늬는 원본색(직접 hex)일 수 있어 슬롯 역할로 드러나지 않는다 — 첫 칠 색을
        # 그대로 보여주고, 무늬 색 변경은 motif_color 축으로 받는다.
        params = motifs[0].get("params", {})
        paint = params.get("color")
        if paint is None and isinstance(params.get("colors"), dict) and params["colors"]:
            paint = next(iter(params["colors"].values()))
        snapshot["motif_color"] = hex_by_id.get(paint, paint)
    return snapshot


class _SlotBook:
    """patch의 hex를 팔레트 슬롯으로 결정론적으로 옮긴다."""

    def __init__(self, raw: dict[str, Any], fixed: frozenset[str] | None) -> None:
        self._slots: list[dict[str, Any]] = raw["palette"]["slots"]
        self._colorways: list[dict[str, Any]] = raw["colorways"]
        self._fixed = fixed

    def _check(self, hex_value: str) -> None:
        if self._fixed is not None and hex_value not in self._fixed:
            raise ConstraintInvalid([f"color {hex_value} is outside the fixed palette"])

    def _map(self, slot_id: str, hex_value: str) -> None:
        for colorway in self._colorways:
            colorway["mapping"][slot_id] = hex_value

    def recolor(self, slot_id: str, hex_value: str) -> None:
        self._check(hex_value)
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
        self._check(hex_value)
        taken = {str(slot.get("id")) for slot in self._slots}
        slot_id = next(
            candidate
            for index in range(len(taken) + 1, 100)
            if (candidate := f"color_{index}") not in taken
        )
        self._slots.append({"id": slot_id, "hex": hex_value})
        self._map(slot_id, hex_value)
        return slot_id


def _apply_stripe(raw: dict[str, Any], patch: StripePatch, *, tile: float, book: _SlotBook) -> None:
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


def _apply_placement(raw: dict[str, Any], patch: PlacementPatch, *, tile: float) -> None:
    for layer in _layers(raw, "motif"):
        placement = layer.get("placement")
        placement = dict(placement) if isinstance(placement, dict) else {}
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
            placement = lattice_placement(
                tile=tile, count=count, staggered=arrangement == "staggered"
            )
        elif patch.count_per_axis is not None and placement.get("type") == "path_following":
            placement["spacing_mm"] = round(tile / count, 6)
        if rotation is not None:
            placement["fixed_rotation_deg"] = rotation
            if placement.get("type") == "path_following":
                placement["rotation"] = "fixed"
        layer["placement"] = placement


def apply_patch(
    intent: dict[str, Any],
    patch: DesignPatchV1,
    *,
    palette_constraint: PaletteConstraint | None = None,
) -> dict[str, Any]:
    """patch를 적용한 새 intent를 돌려준다 — 호출부의 intent는 건드리지 않는다."""

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
    fixed = (
        frozenset(palette_constraint.colors)
        if palette_constraint is not None and palette_constraint.mode == "fixed"
        else None
    )
    book = _SlotBook(raw, fixed)

    if patch.palette is not None:
        for slot in patch.palette.slots:
            book.recolor(slot.id, slot.hex)
    if patch.background is not None:
        backgrounds = _layers(raw, "background")
        if backgrounds:
            book.recolor(backgrounds[0]["params"]["color"], patch.background.color)
    if patch.stripe is not None:
        _apply_stripe(raw, patch.stripe, tile=tile, book=book)
    if patch.placement is not None:
        _apply_placement(raw, patch.placement, tile=tile)
    if patch.motif_size_mm is not None:
        for layer, size in zip(_layers(raw, "motif"), patch.motif_size_mm, strict=False):
            requested = _positive_float(size)
            if requested is not None:
                layer["params"]["size_mm"] = round(min(requested, tile), 6)
    if patch.motif_color is not None:
        slot_id = book.slot_for(patch.motif_color)
        for layer in _layers(raw, "motif"):
            params = layer["params"]
            # 슬롯 이름은 그대로 둔다 — 모티프의 paint slot 계약(colors 키 == color_slots).
            if isinstance(params.get("colors"), dict) and params["colors"]:
                params["colors"] = dict.fromkeys(params["colors"], slot_id)
            else:
                params.pop("colors", None)
                params["color"] = slot_id

    # 참조가 끊긴 슬롯은 남기지 않는다 — 편집이 쌓여도 팔레트가 커지지 않고, colorway는
    # 선언 슬롯 전부를 정확히 매핑해야 한다(engine.palette 불변식).
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
    return raw
