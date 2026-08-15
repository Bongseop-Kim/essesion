import subprocess
from shutil import which

import pytest
from worker.render import raster


@pytest.mark.skipif(
    not (which("rsvg-convert") or which("resvg")), reason="no system SVG rasterizer"
)
def test_real_renderer_reads_svg_from_stdin():
    """실제 렌더러를 한 번은 돌린다 — 인자 형태가 어긋나면 조용히 preview만 사라진다."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" '
        'viewBox="0 0 10 10"><rect width="10" height="10" fill="#103A40"/></svg>'
    )
    png, media = raster.rasterize_svg(svg, width_mm=10, dpi=300)
    assert media == "image/png"
    assert png.startswith(b"\x89PNG")


def test_total_pixel_budget_rejected_before_starting_renderer(monkeypatch):
    def unexpected_binary_lookup(_name: str):
        raise AssertionError("renderer lookup must happen after resource validation")

    monkeypatch.setattr(raster, "which", unexpected_binary_lookup)
    with pytest.raises(raster.RasterError, match="raster area exceeds"):
        raster.rasterize_svg("<svg/>", width_mm=500, height_mm=500, dpi=600)


def test_renderer_timeout_is_normalized(monkeypatch):
    monkeypatch.setattr(
        raster,
        "which",
        lambda name: "/usr/bin/rsvg-convert" if name == "rsvg-convert" else None,
    )

    def timeout(*_args, **_kwargs):
        raise subprocess.TimeoutExpired(cmd="rsvg-convert", timeout=raster.RASTER_TIMEOUT_SECONDS)

    monkeypatch.setattr(raster.subprocess, "run", timeout)
    with pytest.raises(raster.RasterError, match="timed out"):
        raster.rasterize_svg("<svg/>", width_mm=10, dpi=300)
