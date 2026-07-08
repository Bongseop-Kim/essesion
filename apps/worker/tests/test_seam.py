"""래스터 이음새 회귀 가드 — 원본 test_seamless/test_seamless_mvp의 seam 계층 이식.

렌더러(rsvg-convert/resvg)가 없으면 래스터 가드는 skip — 측정 유틸 단위 테스트는 항상 실행.
"""

import io
from shutil import which

import pytest
from PIL import Image
from worker.engine.composition import render_svg_document
from worker.engine.generate import generate
from worker.render.raster import rasterize_svg

from .golden_helpers import golden_intents, register_golden_motifs
from .intent_helpers import mvp_intent, register_test_motifs
from .seam_helpers import TILING_SEAM_TOL, edge_seam, tiling_seam

register_test_motifs()
register_golden_motifs()

_RENDERER = which("rsvg-convert") or which("resvg")


def _tile(
    width: int, height: int, pixel: tuple[int, ...] = (0, 0, 0, 0)
) -> list[list[tuple[int, ...]]]:
    return [[pixel for _ in range(width)] for _ in range(height)]


# --- 측정 유틸 단위 테스트 ----------------------------------------------------


def test_edge_seam_zero_when_opposite_edges_match():
    tile = _tile(8, 8)
    for row in tile:
        row[3:5] = [(200, 200, 200, 200)] * 2
    assert edge_seam(tile) == (0.0, 0.0)


def test_edge_seam_detects_mismatched_edges():
    tile = _tile(8, 8)
    for row in tile:
        row[-1] = (255, 255, 255, 255)
    seam_x, _ = edge_seam(tile)
    assert seam_x > 100


def test_seam_checks_reject_ragged_rows():
    with pytest.raises(ValueError, match="rectangular"):
        edge_seam([[(0, 0, 0, 0)], [(0, 0, 0, 0), (0, 0, 0, 0)]])


def test_tiling_seam_rejects_invalid_bounds():
    arr = [[(0, 0, 0, 0) for _ in range(10)] for _ in range(10)]
    with pytest.raises(ValueError, match="margin"):
        tiling_seam(arr, tile_px=5, margin=-1)
    with pytest.raises(ValueError, match="tile_px"):
        tiling_seam(arr, tile_px=9, margin=2)


# --- 래스터 회귀 가드 (렌더러 핀, 없으면 skip) ---------------------------------


def _tiled_svg(single_tile_svg: str, tile_mm: float, tiles: int) -> str:
    defs = single_tile_svg[
        single_tile_svg.index("<defs>") + len("<defs>") : single_tile_svg.index("</defs>")
    ]
    side = tiles * tile_mm
    body = f'<rect x="0" y="0" width="{side}" height="{side}" fill="url(#tile)"/>'
    return render_svg_document(body, side, side, defs=defs)


def _assert_tiles_without_seam(intent: dict) -> None:
    tile_mm = float(intent["canvas"]["tile_mm"])
    svg = generate(intent).svg
    png, _ = rasterize_svg(_tiled_svg(svg, tile_mm, 2), width_mm=2 * tile_mm, dpi=300)
    image = Image.open(io.BytesIO(png)).convert("RGBA")
    tile_px = round(tile_mm / 25.4 * 300)
    excess_x, excess_y = tiling_seam(image, tile_px)
    assert excess_x <= TILING_SEAM_TOL
    assert excess_y <= TILING_SEAM_TOL


@pytest.mark.skipif(_RENDERER is None, reason="rsvg-convert/resvg not available")
def test_mvp_tiles_without_seam():
    _assert_tiles_without_seam(mvp_intent())


_SEAM_GUARD_STEMS = (
    "06_motif_lattice_block",  # lattice
    "09_motif_scatter_poisson",  # scatter (blue-noise)
    "12_motif_path_diagonal_wave",  # 대각 path + wave
)


@pytest.mark.skipif(_RENDERER is None, reason="rsvg-convert/resvg not available")
@pytest.mark.parametrize("stem", _SEAM_GUARD_STEMS)
def test_golden_tiles_without_seam(stem):
    intent = dict(golden_intents())[stem]
    _assert_tiles_without_seam(intent)
