"""normalize 단위 테스트 — DB 불필요 (worker-motifs.md §1·§2).

프레이밍 산술·거부군·색 양자화 동점·slotify 순서·해시 안정성/결정론.
render_check=False로 librsvg 유무와 무관하게 결정론적.
"""

import pytest
from worker.motifs.normalize import normalize_motif_svg
from worker.render.sanitize import SanitizeError


def _svg(inner: str, viewbox: str = "0 0 100 100") -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}">{inner}</svg>'


def test_framing_arithmetic_centers_and_scales_to_unit_box():
    # rect (10,10) 40x20 → tight bbox 중심 (30,20), 긴 변 40 → scale 1/40, tx -0.75, ty -0.5
    motif = normalize_motif_svg(
        _svg('<rect x="10" y="10" width="40" height="20" fill="#ff0000"/>'), render_check=False
    )
    assert 'transform="translate(-0.75 -0.5) scale(0.025)"' in motif.symbol
    assert motif.bbox_mm == (-0.5, -0.5, 0.5, 0.5)
    assert motif.anchor == (0.0, 0.0)
    assert motif.color_slots == ("s0",)


def test_single_color_uses_currentcolor_and_is_colorway_agnostic():
    # 같은 도형·다른 색 → 같은 id(단색은 currentColor로 정규화되어 색 무관 해시).
    red = normalize_motif_svg(
        _svg('<rect x="10" y="10" width="40" height="20" fill="#ff0000"/>'), render_check=False
    )
    green = normalize_motif_svg(
        _svg('<rect x="10" y="10" width="40" height="20" fill="#00ff00"/>'), render_check=False
    )
    assert red.id == green.id
    assert "currentColor" in red.symbol
    assert red.id.startswith("recraft-")


def test_multicolor_slotify_first_appearance_order():
    motif = normalize_motif_svg(
        _svg(
            '<rect x="10" y="10" width="30" height="30" fill="#ff0000"/>'
            '<rect x="50" y="50" width="30" height="30" fill="#0000ff"/>'
        ),
        render_check=False,
    )
    assert motif.color_slots == ("s0", "s1")
    assert 'fill="s0"' in motif.symbol
    assert 'fill="s1"' in motif.symbol


def test_determinism_repeated_normalization_is_identical():
    svg = _svg('<path d="M10 10 L60 10 L35 60 Z" fill="#123456"/>')
    a = normalize_motif_svg(svg, render_check=False)
    b = normalize_motif_svg(svg, render_check=False)
    assert (a.id, a.symbol, a.color_slots) == (b.id, b.symbol, b.color_slots)


def test_quantize_merges_down_to_budget():
    motif = normalize_motif_svg(
        _svg(
            '<rect x="0" y="0" width="20" height="20" fill="#ff0000"/>'
            '<rect x="20" y="20" width="20" height="20" fill="#00ff00"/>'
            '<rect x="40" y="40" width="20" height="20" fill="#0000ff"/>'
        ),
        max_color_slots=2,
        render_check=False,
    )
    assert len(motif.color_slots) == 2


def test_quantize_unmergeable_nonhex_over_budget_raises():
    # concrete 비-hex paint(currentColor/named)가 예산을 초과하면 병합 불가 → ValueError.
    with pytest.raises(ValueError, match="cannot be quantized"):
        normalize_motif_svg(
            _svg(
                '<rect x="0" y="0" width="20" height="20" fill="currentColor"/>'
                '<rect x="20" y="20" width="20" height="20" fill="red"/>'
                '<rect x="40" y="40" width="20" height="20" fill="green"/>'
            ),
            max_color_slots=2,
            render_check=False,
        )


def test_rejects_no_drawable_geometry():
    with pytest.raises(ValueError, match="no drawable geometry"):
        normalize_motif_svg(
            _svg("<defs><rect x='0' y='0' width='5' height='5'/></defs>"), render_check=False
        )


def test_rejects_excessive_aspect_ratio():
    with pytest.raises(ValueError, match="aspect ratio"):
        normalize_motif_svg(
            _svg('<rect x="0" y="49" width="100" height="2" fill="#000000"/>'), render_check=False
        )


def test_rejects_zero_extent():
    with pytest.raises(ValueError, match="zero extent|degenerate"):
        normalize_motif_svg(
            _svg('<rect x="10" y="10" width="0" height="0" fill="#000000"/>'), render_check=False
        )


def test_rejects_raster_image_via_allowlist():
    with pytest.raises(SanitizeError):
        normalize_motif_svg(
            _svg('<image href="data:x" width="10" height="10"/>'), render_check=False
        )


def test_rejects_missing_viewbox_and_size():
    no_frame = (
        '<svg xmlns="http://www.w3.org/2000/svg">'
        '<rect x="0" y="0" width="5" height="5" fill="#000"/></svg>'
    )
    with pytest.raises(ValueError, match="viewBox or positive"):
        normalize_motif_svg(no_frame, render_check=False)
