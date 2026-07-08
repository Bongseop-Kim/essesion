"""래스터 이음새 측정 유틸 — 원본 seamless-tile app/validate/seamless.py의 테스트 이식.

by-construction 불변식(engine/seamless.py)이 1차 보증이고, 이 지표는 렌더러 교체·회귀를
잡는 2차 가드다. tiling_seam은 내부 기준선을 흡수하므로 하드 엣지에 강건하다.
"""

from typing import Any

from PIL import Image

# tiling_seam 초과분(per-channel mean) 허용치 — seamless 타일의 이음새 불연속은
# 자기 내부 기준선을 이 값 이상 초과하면 안 된다.
TILING_SEAM_TOL = 1.0

Rows = list[list[tuple[int, ...]]]


def _rows(tile_rgba) -> Rows:
    """PIL 이미지 또는 중첩 픽셀 행 배열을 직사각 행 리스트로 정규화."""
    if isinstance(tile_rgba, Image.Image):
        width, height = tile_rgba.size
        # 일부 Pillow 빌드의 get_flattened_data는 픽셀 튜플 대신 평탄 int 버퍼를 반환한다.
        raw: Any = (
            tile_rgba.get_flattened_data()
            if hasattr(tile_rgba, "get_flattened_data")
            else tile_rgba.getdata()
        )
        data: list[Any] = list(raw)
        if data and isinstance(data[0], int):
            bands = len(tile_rgba.getbands())
            data = [tuple(data[i : i + bands]) for i in range(0, len(data), bands)]
        return [data[y * width : (y + 1) * width] for y in range(height)]
    rows: Rows = []
    width = None
    try:
        for row in tile_rgba:
            normalized = [tuple(int(c) for c in pixel) for pixel in row]
            if width is None:
                width = len(normalized)
            elif len(normalized) != width:
                raise ValueError("tile_rgba rows must be rectangular")
            rows.append(normalized)
    except TypeError as exc:
        raise ValueError("tile_rgba must be a rectangular 2D array") from exc
    return rows


def _mean_abs(pairs) -> float:
    total = 0
    count = 0
    for a, b in pairs:
        for ca, cb in zip(a, b, strict=False):
            total += abs(int(ca) - int(cb))
            count += 1
    return float(total / count) if count else 0.0


def edge_seam(tile_rgba) -> tuple[float, float]:
    """한 타일의 마주보는 가장자리 간 per-channel 평균 차 — 반복 시 col -1이 다음 타일
    col 0과 맞닿는다. 하드 엣지 패턴은 정당하게 값이 클 수 있으니 그 경우 by-construction
    으로 검증할 것."""
    arr = _rows(tile_rgba)
    seam_x = _mean_abs((row[0], row[-1]) for row in arr)
    seam_y = _mean_abs(zip(arr[0], arr[-1], strict=False))
    return seam_x, seam_y


def tiling_seam(tiled_rgba, tile_px: int, margin: int = 4) -> tuple[float, float]:
    """N-타일 래스터에서 내부 타일 경계(col/row `tile_px`)의 불연속이 내부 최악 기준선을
    얼마나 초과하는지 (excess_x, excess_y). <= 0이면 내부 엣지 이상의 이음새 없음.

    한계: 내부 기준선보다 작은 실제 이음새는 가려진다 — 그래서 하중은 by-construction
    불변식이 지고, 이것은 회귀 가드다.
    """
    arr = _rows(tiled_rgba)
    if not arr or not arr[0]:
        raise ValueError("tiled_rgba must be at least a 2D array")
    h, w = len(arr), len(arr[0])
    if margin < 0:
        raise ValueError("margin must be non-negative")
    if tile_px <= 0:
        raise ValueError("tile_px must be greater than 0")
    if tile_px < margin:
        raise ValueError("tile_px must be greater than or equal to margin")
    if tile_px >= w - margin or tile_px >= h - margin:
        raise ValueError("tile_px must be less than both width - margin and height - margin")

    def col_disc(c: int) -> float:
        return _mean_abs((row[c], row[c - 1]) for row in arr)

    def row_disc(r: int) -> float:
        return _mean_abs(zip(arr[r], arr[r - 1], strict=False))

    seam_x = col_disc(tile_px)
    seam_y = row_disc(tile_px)
    base_x = max(
        (col_disc(c) for c in range(margin, w - margin) if abs(c - tile_px) > margin),
        default=0.0,
    )
    base_y = max(
        (row_disc(r) for r in range(margin, h - margin) if abs(r - tile_px) > margin),
        default=0.0,
    )
    return seam_x - base_x, seam_y - base_y
