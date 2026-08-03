"""Structured constraints applied at the deterministic engine boundary.

구조화된 사용자 축은 남아 있지 않다 — 크기·밀도·배치·방향과 색 지정 모두 폐기됐고,
그 자리는 입력창 문장 → 구성 patch(`engine.patch`)가 대신한다. 남은 기계는 격자 겹침
클램프(품질 가드)뿐이다.
"""

from __future__ import annotations

import copy
import math
import re
from typing import Any

_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
# 격자에서 모티프가 셀보다 크면 인스턴스가 반드시 겹친다. 살짝 닿는 밀집(플로랄 등)은
# 디자인일 수 있어 셀의 1.15배까지 허용하고, 그 위는 형상 파괴로 보고 클램프한다.
LATTICE_OVERLAP_ALLOWANCE = 1.15


class ConstraintInvalid(ValueError):
    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))


def normalize_hex(value: str) -> str:
    # Tolerate one missing leading '#': the authoring model routinely emits bare hex ("00008b").
    # removeprefix (not lstrip) so a doubled "##..." stays malformed and is rejected below.
    # Canonical output stays "#RRGGBB" upper, so the SVG contract is unchanged.
    value = "#" + value.strip().removeprefix("#")
    if not _HEX.fullmatch(value):
        raise ValueError("color must be #RGB or #RRGGBB")
    digits = value[1:]
    if len(digits) == 3:
        digits = "".join(char * 2 for char in digits)
    return f"#{digits.upper()}"


def ordered_slot_refs(raw: dict[str, Any]) -> list[str]:
    """레이어가 실제로 참조하는 팔레트 슬롯 id — 선언 순서, 중복 제거."""
    refs: list[str] = []
    layers = raw.get("layers")
    if not isinstance(layers, list):
        return refs
    for layer in layers:
        if not isinstance(layer, dict):
            continue
        params = layer.get("params")
        if not isinstance(params, dict):
            continue
        layer_type = layer.get("type")
        candidates: list[object] = []
        if layer_type == "background":
            candidates.append(params.get("color"))
        elif layer_type == "stripe":
            bands = params.get("bands")
            if isinstance(bands, list):
                candidates.extend(band.get("color") for band in bands if isinstance(band, dict))
        for candidate in candidates:
            if isinstance(candidate, str) and candidate and candidate not in refs:
                refs.append(candidate)
    return refs


def _motif_layers(raw: dict[str, Any]) -> list[dict[str, Any]]:
    layers = raw.get("layers")
    if not isinstance(layers, list):
        return []
    return [layer for layer in layers if isinstance(layer, dict) and layer.get("type") == "motif"]


def lattice_placement(*, tile: float, count: int, staggered: bool) -> dict[str, Any]:
    """축당 count개 격자 — 셀은 항상 tile을 나눈다(seamless 불변식). 엇갈림은 짝수 축."""
    if staggered and count % 2:
        count = min(10, count + 1)
    lattice: dict[str, Any] = {
        "cell_w_mm": round(tile / count, 6),
        "cell_h_mm": round(tile / count, 6),
    }
    if staggered:
        lattice.update({"drop_fraction": 0.5, "drop_axis": "column"})
    return {"type": "lattice", "lattice": lattice}


def scatter_placement(*, tile: float, axis: int, count: int) -> dict[str, Any]:
    """축당 axis개 간격의 Poisson 산개."""
    return {
        "type": "scatter",
        "scatter": {
            "mode": "poisson",
            "min_dist_mm": round(tile / axis, 6),
            "count": count,
        },
    }


def lattice_size_limit(cell_mm: float) -> float:
    """격자 셀 크기에 대한 모티프 size_mm 상한.

    회전(fixed_rotation_deg)으로 커지는 실제 바운딩 박스는 계산하지 않는다 — 상한이
    회전각까지 반영해야 할 만큼 문제가 되면 여기에 cos/sin 보정을 더하면 된다.
    """
    return round(cell_mm * LATTICE_OVERLAP_ALLOWANCE, 6)


def _lattice_cell_mm(layer: dict[str, Any]) -> float | None:
    """격자 배치 레이어의 짧은 쪽 셀 크기 — 격자가 아니면 None."""
    placement = layer.get("placement")
    if not isinstance(placement, dict) or placement.get("type") != "lattice":
        return None
    lattice = placement.get("lattice")
    if not isinstance(lattice, dict):
        return None
    cells = [
        float(lattice[key])
        for key in ("cell_w_mm", "cell_h_mm")
        if isinstance(lattice.get(key), int | float)
        and math.isfinite(float(lattice[key]))
        and float(lattice[key]) > 0
    ]
    return min(cells) if len(cells) == 2 else None


def _clamp_lattice_overlap(raw: dict[str, Any], warnings: list[str]) -> None:
    """겹침이 형상을 뭉개는 격자 모티프를 셀 기준으로 줄인다(조용한 정규화 + 경고).

    저작 모델은 size_ratio와 columns/rows를 서로 모르는 필드로 내보내고, 구성 patch도 크기와
    배치를 따로 바꾸므로 두 경로 모두 관계가 깨진다. 프롬프트 규칙으로는 위반율이 떨어지지
    않아(리뷰 design-input-modality-e2e-2026-07-30) 여기서 결정론적으로 잡는다.
    """
    for layer in _motif_layers(raw):
        params = layer.get("params")
        cell = _lattice_cell_mm(layer)
        if cell is None or not isinstance(params, dict):
            continue
        size = params.get("size_mm")
        if not isinstance(size, int | float) or not math.isfinite(float(size)):
            continue
        limit = lattice_size_limit(cell)
        if float(size) <= limit + 1e-9:
            continue
        params["size_mm"] = limit
        warnings.append(
            f"layer {layer.get('id')!r}: size_mm {float(size)} clamped to {limit} "
            f"(lattice cell {cell} × {LATTICE_OVERLAP_ALLOWANCE})"
        )


def apply_generation_constraints(
    raw: dict[str, Any],
    *,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    """Return a constrained deep copy; never partially mutate the caller on failure."""

    constrained = copy.deepcopy(raw)
    _clamp_lattice_overlap(constrained, warnings if warnings is not None else [])
    return constrained
