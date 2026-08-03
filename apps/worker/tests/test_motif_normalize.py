"""normalize 단위 테스트 — DB 불필요 (worker-motifs.md §1·§2).

프레이밍 산술·거부군·구체 색 보존·해시 안정성/결정론.
render_check=False로 librsvg 유무와 무관하게 결정론적.
"""

from shutil import which

import pytest
from svg_safety import SanitizeError
from worker.motifs.normalize import normalize_motif_svg

_RENDERER = which("rsvg-convert") or which("resvg")


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
    assert 'fill="#ff0000"' in motif.symbol


def test_concrete_color_is_part_of_motif_identity():
    # 같은 도형이라도 색이 다르면 별개의 불변 모티프다.
    red = normalize_motif_svg(
        _svg('<rect x="10" y="10" width="40" height="20" fill="#ff0000"/>'), render_check=False
    )
    green = normalize_motif_svg(
        _svg('<rect x="10" y="10" width="40" height="20" fill="#00ff00"/>'), render_check=False
    )
    assert red.id != green.id
    assert 'fill="#ff0000"' in red.symbol
    assert 'fill="#00ff00"' in green.symbol
    assert red.id.startswith("recraft-")


def test_multicolor_paints_are_preserved_verbatim():
    motif = normalize_motif_svg(
        _svg(
            '<rect x="10" y="10" width="30" height="30" fill="#ff0000"/>'
            '<rect x="50" y="50" width="30" height="30" fill="#0000ff"/>'
        ),
        render_check=False,
    )
    assert 'fill="#ff0000"' in motif.symbol
    assert 'fill="#0000ff"' in motif.symbol
    assert "currentColor" not in motif.symbol


def test_determinism_repeated_normalization_is_identical():
    svg = _svg('<path d="M10 10 L60 10 L35 60 Z" fill="#123456"/>')
    a = normalize_motif_svg(svg, render_check=False)
    b = normalize_motif_svg(svg, render_check=False)
    assert (a.id, a.symbol, a.preview_svg) == (b.id, b.symbol, b.preview_svg)


def test_currentcolor_is_resolved_from_the_document_color():
    motif = normalize_motif_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" color="#ABCDEF">'
        '<rect x="10" y="10" width="40" height="20" fill="currentColor"/></svg>',
        render_check=False,
    )
    explicit = normalize_motif_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect x="10" y="10" width="40" height="20" fill="#abcdef"/></svg>',
        render_check=False,
    )
    assert 'fill="#abcdef"' in motif.symbol
    assert "currentColor" not in motif.symbol
    assert motif.id == explicit.id


def test_root_fill_is_inherited_instead_of_dropped_with_the_root_element():
    # 루트를 버리고 자식만 취하면 이 원이 검게 변하고, 무채색 문서와 같은 id가 된다.
    colored = normalize_motif_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="#c0445a">'
        '<circle cx="50" cy="50" r="30"/></svg>',
        render_check=False,
    )
    unpainted = normalize_motif_svg(
        _svg('<circle cx="50" cy="50" r="30"/>'),
        render_check=False,
    )

    assert 'fill="#c0445a"' in colored.symbol
    assert colored.id != unpainted.id
    # preview_svg를 다시 임포트해도 같은 정체성이어야 한다(래핑 `<g>`가 그 문서에 함께 있다).
    assert normalize_motif_svg(colored.preview_svg, render_check=False).id == colored.id


def test_root_stroke_survives_a_fill_none_document():
    outline = normalize_motif_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
        'stroke="#000000" fill="none" stroke-width="4">'
        '<line x1="10" y1="10" x2="90" y2="90"/></svg>',
        render_check=False,
    )

    assert 'stroke="#000000"' in outline.symbol
    assert 'stroke-width="4"' in outline.symbol


def test_root_opacity_wraps_the_children_as_one_group():
    # opacity는 그룹 단위 합성이라 자식마다 복사하면 겹친 도형의 결과가 달라진다.
    faded = normalize_motif_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" opacity="0.5">'
        '<rect x="10" y="10" width="40" height="40" fill="#ff0000"/>'
        '<rect x="30" y="30" width="40" height="40" fill="#0000ff"/></svg>',
        render_check=False,
    )

    assert faded.symbol.count('opacity="0.5"') == 1


def test_equivalent_paint_notations_collapse_to_one_motif_id():
    ids = {
        normalize_motif_svg(
            _svg(f'<rect x="10" y="10" width="40" height="20" fill="{paint}"/>'),
            render_check=False,
        ).id
        for paint in ("#FF0000", "#f00", "rgb(255,0,0)", "rgb(255, 0, 0)", "rgba(255,0,0,1)")
    }

    assert len(ids) == 1


@pytest.mark.parametrize("paint", ["red", "19-4024 TCX", "url(#g)"])
def test_rejects_paints_we_cannot_pin_to_a_hex(paint: str):
    # named color·Pantone은 hex를 확정할 수 없고, url()은 모티프에 있을 수 없는 paint server다
    # (gradient/pattern 침투를 계약 층에서 함께 막는다).
    with pytest.raises(ValueError, match="motif paint"):
        normalize_motif_svg(
            _svg(f'<rect x="10" y="10" width="40" height="20" fill="{paint}"/>'),
            render_check=False,
        )


@pytest.mark.skipif(_RENDERER is None, reason="rsvg-convert/resvg not available")
def test_rejects_a_motif_that_renders_nothing():
    # 완전 투명 래스터는 seam이 0이라 렌더 게이트를 그냥 통과했다.
    with pytest.raises(ValueError, match="renders nothing"):
        normalize_motif_svg(
            _svg('<rect x="10" y="10" width="40" height="40" fill="none"/>'),
            render_check=True,
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
