"""래스터 이음새 회귀 가드 — 원본 test_seamless/test_seamless_mvp의 seam 계층 이식.

렌더러(rsvg-convert/resvg)가 없으면 래스터 가드는 skip — 측정 유틸 단위 테스트는 항상 실행.
"""

import io
from shutil import which

import pytest
from PIL import Image, ImageChops
from worker.engine.composition import _instance_transform, render_svg_document
from worker.engine.generate import generate
from worker.engine.intent import MotifLayer
from worker.engine.placement import Instance, place
from worker.engine.primitives import Background, Stripe, build_primitive
from worker.engine.validate import validate_intent
from worker.motifs.registry import resolve_motif
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


# --- 독립 배치 oracle (design-engine-accuracy 5단계) ---------------------------
#
# tiling_seam은 같은 <pattern>을 두 번 그린 결과를 자기 자신과 비교하므로 경계 클론이
# 통째로 빠져도 잡지 못한다. 여기서는 같은 place() 결과를 이웃 타일 좌표에 **직접** 깔아
# 렌더한 영역과, 단일 타일 PNG를 이어 붙인 모자이크를 비교한다. 클론 기계를 쓰지 않는
# 경로라 클론 누락이 그대로 차이로 드러난다.

_DEFAULT_COLORWAY = "default"
_SEAM_TILES = 2
_SEAM_DPI = 300
# 기준선은 mean 0.0013 / max 12(안티앨리어싱)이고, 클론을 빼면 mean 0.04+ / max 43+로
# 뛴다 — 그 사이에 둔다.
_MEAN_DIFF_TOL = 0.01
_MAX_DIFF_TOL = 24


def _raster(svg: str, side_mm: float) -> Image.Image:
    png, _ = rasterize_svg(svg, width_mm=side_mm, dpi=_SEAM_DPI)
    return Image.open(io.BytesIO(png)).convert("RGB")


def _independent_svg(raw: dict, tiles: int) -> str:
    """이웃 인스턴스를 직접 배치한 tiles×tiles 영역 — <pattern>도 경계 클론도 쓰지 않는다."""
    result = validate_intent(raw)
    intent, palette = result.intent, result.palette
    tile = intent.canvas.tile_mm
    side = tile * tiles
    layers = sorted(intent.layers, key=lambda layer: (layer.z_order, layer.id))
    # 줄무늬·배경은 해석적으로 주기적이라 넓힌 캔버스에서 다시 그린다. 모티프는 원래 타일에서
    # 배치한 뒤 이웃 좌표로 옮긴다 — 이웃 링(-1..tiles)까지 그려야 가장자리가 채워진다.
    wide = {
        layer.id: build_primitive(layer, side)
        for layer in layers
        if layer.type in ("background", "stripe")
    }
    hosts = {
        layer.id: build_primitive(layer, tile)
        for layer in layers
        if layer.type in ("background", "stripe")
    }
    symbols: dict[str, str] = {}
    parts: list[str] = []
    for layer in layers:
        primitive = wide.get(layer.id)
        if isinstance(primitive, Background):
            parts.append(primitive.render(side, palette, _DEFAULT_COLORWAY))
            continue
        if isinstance(primitive, Stripe):
            parts.append(primitive.render(palette, _DEFAULT_COLORWAY))
            continue
        assert isinstance(layer, MotifLayer)
        placement = layer.placement
        assert placement is not None
        host = hosts.get(placement.host_layer) if placement.host_layer else None
        assert host is None or isinstance(host, Stripe)
        motif = resolve_motif(layer.params.motif_id, None)
        symbols.setdefault(motif.id, motif.symbol)
        size_mm = layer.params.size_mm
        for inst in place(layer, host, tile, intent.seed):
            for i in range(-1, tiles + 1):
                for j in range(-1, tiles + 1):
                    shifted = Instance(
                        inst.x_mm + i * tile, inst.y_mm + j * tile, inst.rotation_deg
                    )
                    transform = _instance_transform(motif, shifted, size_mm)
                    parts.append(f'<use href="#motif-{motif.id}" transform="{transform}"/>')
    return render_svg_document("".join(parts), side, side, defs="".join(symbols.values()))


def _mosaic_vs_independent(raw: dict) -> tuple[float, int]:
    """(평균 채널 차, 최대 픽셀 차) — 두 렌더가 같은 그림이면 안티앨리어싱 오차만 남는다."""
    tile = float(raw["canvas"]["tile_mm"])
    single = _raster(generate(raw).svg, tile)
    tile_px = single.size[0]
    mosaic = Image.new("RGB", (tile_px * _SEAM_TILES, tile_px * _SEAM_TILES))
    for i in range(_SEAM_TILES):
        for j in range(_SEAM_TILES):
            mosaic.paste(single, (i * tile_px, j * tile_px))
    independent = _raster(_independent_svg(raw, _SEAM_TILES), tile * _SEAM_TILES)
    # 픽셀 정렬을 강제한다 — 반올림으로 크기가 어긋나면 비교 자체가 무의미하다.
    assert mosaic.size == independent.size
    histogram = ImageChops.difference(mosaic, independent).convert("L").histogram()
    mean = sum(value * count for value, count in enumerate(histogram)) / sum(histogram)
    worst = max(value for value, count in enumerate(histogram) if count)
    return mean, worst


@pytest.mark.skipif(_RENDERER is None, reason="rsvg-convert/resvg not available")
@pytest.mark.parametrize("stem", _SEAM_GUARD_STEMS)
def test_tiled_pattern_matches_independently_placed_neighbours(stem):
    mean, worst = _mosaic_vs_independent(dict(golden_intents())[stem])
    assert mean <= _MEAN_DIFF_TOL
    assert worst <= _MAX_DIFF_TOL


@pytest.mark.skipif(_RENDERER is None, reason="rsvg-convert/resvg not available")
def test_mvp_matches_independently_placed_neighbours():
    mean, worst = _mosaic_vs_independent(mvp_intent())
    assert mean <= _MEAN_DIFF_TOL
    assert worst <= _MAX_DIFF_TOL


@pytest.mark.skipif(_RENDERER is None, reason="rsvg-convert/resvg not available")
def test_dropping_boundary_clones_is_actually_detected(monkeypatch):
    """oracle이 실제로 무엇을 잡는지 — 경계 클론을 뺀 변형이 반드시 걸려야 한다."""
    monkeypatch.setattr(
        "worker.engine.composition.clone_instances", lambda instances, **_: list(instances)
    )
    mean, worst = _mosaic_vs_independent(dict(golden_intents())["06_motif_lattice_block"])
    assert mean > _MEAN_DIFF_TOL
    assert worst > _MAX_DIFF_TOL
