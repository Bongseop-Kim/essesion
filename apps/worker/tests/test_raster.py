import subprocess

import pytest
from worker.render import raster


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
