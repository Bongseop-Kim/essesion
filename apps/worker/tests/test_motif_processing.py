import base64
import hashlib
import io
from pathlib import Path

import pytest
from PIL import Image
from worker.motifs.normalize import normalize_motif_svg
from worker.motifs.photo_svg import (
    _canonicalize_vtracer_svg,
    decode_user_image,
    extract_palette,
    photo_to_svg,
)
from worker.motifs.text_svg import normalize_text_motif_input, text_to_svg


def _simple_photo(*, flat: bool = False) -> bytes:
    image = Image.new("RGB", (64, 64), "white")
    if not flat:
        for y in range(16, 48):
            for x in range(16, 48):
                image.putpixel((x, y), (220, 20, 40))
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def test_text_to_svg_is_path_only_nfc_normalized_and_deterministic():
    kwargs = {"font_id": "nanum-gothic", "font_weight": 400, "letter_spacing": 0.1}
    composed = text_to_svg("가A1", **kwargs)
    decomposed = text_to_svg("가A1", **kwargs)

    assert composed == decomposed
    assert "<path" in composed
    assert "<text" not in composed
    assert text_to_svg("가A1", **kwargs) == composed
    assert text_to_svg("가A1", **{**kwargs, "font_weight": 700}) != composed

    first = normalize_motif_svg(composed, id_prefix="upload", render_check=False)
    second = normalize_motif_svg(
        text_to_svg("가A1", **kwargs), id_prefix="upload", render_check=False
    )
    assert (first.id, first.symbol) == (second.id, second.symbol)
    reimported = normalize_motif_svg(first.preview_svg, id_prefix="upload", render_check=False)
    assert (reimported.id, reimported.symbol) == (first.id, first.symbol)
    assert reimported.preview_svg == first.preview_svg


def test_text_motif_character_boundary_is_explicit():
    assert normalize_text_motif_input("ABC 123 가 ㄱ") == "ABC 123 가 ㄱ"
    with pytest.raises(ValueError, match=r"U\+002D"):
        normalize_text_motif_input("A-B")
    with pytest.raises(ValueError, match=r"U\+1F642"):
        normalize_text_motif_input("🙂")


def test_text_motif_length_and_path_complexity_fail_closed(monkeypatch):
    with pytest.raises(ValueError, match="at most 20"):
        normalize_text_motif_input("가" * 21)

    monkeypatch.setattr("worker.motifs.text_svg.MAX_TEXT_PATH_COMMANDS", 1)
    with pytest.raises(ValueError, match="path complexity"):
        text_to_svg("가", font_id="nanum-gothic", font_weight=400)


def test_bundled_font_assets_match_documented_hashes():
    font_dir = Path(__file__).parents[1] / "src/worker/motifs/fonts"
    expected = {
        "NanumGothic-Regular.ttf": (
            "76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31"
        ),
        "NanumGothic-Bold.ttf": "f96298f9fb18e364d2370f4c3ce948ac67a2b61af992d7234bc15c42b033c674",
        "NanumMyeongjo-Regular.ttf": (
            "7ed9e8653a8ed04285d51dc343ffea6eb3d9c73afc27383ea8929ee4ffd03205"
        ),
        "NanumMyeongjo-Bold.ttf": (
            "bc9ed8e60d93fe6db054b8fb988481b625f2eef8cb2317ad0e9834681b8fe3f3"
        ),
    }
    assert {
        name: hashlib.sha256((font_dir / name).read_bytes()).hexdigest() for name in expected
    } == expected


def test_palette_extraction_is_deterministic_and_population_ordered():
    raw = _simple_photo()
    assert extract_palette(raw, "image/png", 5) == ["#FFFFFF", "#DC1428"]
    assert extract_palette(raw, "image/png", 5) == extract_palette(raw, "image/png", 5)


def test_photo_vectorization_removes_flat_border_and_returns_png_preview():
    result = photo_to_svg(
        _simple_photo(),
        "image/png",
        remove_background=True,
        simplification="medium",
        color_count=2,
    )
    assert result.background_confidence is not None and result.background_confidence >= 0.55
    assert "<path" in result.svg
    assert "#DC1428" in result.svg
    assert "#FFFFFF" not in result.svg
    assert result.warnings
    repeated = photo_to_svg(
        _simple_photo(),
        "image/png",
        remove_background=True,
        simplification="medium",
        color_count=2,
    )
    assert result == repeated
    first = normalize_motif_svg(result.svg, id_prefix="upload", render_check=False)
    second = normalize_motif_svg(repeated.svg, id_prefix="upload", render_check=False)
    assert (first.id, first.symbol) == (second.id, second.symbol)
    reimported = normalize_motif_svg(first.preview_svg, id_prefix="upload", render_check=False)
    assert (reimported.id, reimported.symbol) == (first.id, first.symbol)
    assert reimported.preview_svg == first.preview_svg
    with Image.open(io.BytesIO(base64.b64decode(result.processed_preview_base64))) as preview:
        assert preview.format == "PNG"
        assert preview.mode == "RGBA"
        pixel = preview.getpixel((0, 0))
        assert isinstance(pixel, tuple) and pixel[3] == 0


def test_photo_vectorization_can_keep_background_and_flat_removal_fails_closed():
    kept = photo_to_svg(
        _simple_photo(),
        "image/png",
        remove_background=False,
        simplification="high",
        color_count=2,
    )
    assert kept.background_confidence is None
    assert "#FFFFFF" in kept.svg and "#DC1428" in kept.svg

    with pytest.raises(ValueError, match="empty or frame-filling"):
        photo_to_svg(
            _simple_photo(flat=True),
            "image/png",
            remove_background=True,
            simplification="medium",
            color_count=2,
        )


def test_photo_mime_is_verified_from_bytes():
    with pytest.raises(ValueError, match="does not match"):
        extract_palette(_simple_photo(), "image/jpeg", 3)


def test_photo_pixel_cap_fails_before_decode(monkeypatch):
    monkeypatch.setattr("worker.motifs.photo_svg.MAX_PHOTO_PIXELS", 1_000)
    with pytest.raises(ValueError, match="too many pixels"):
        decode_user_image(_simple_photo(), "image/png")


@pytest.mark.parametrize(
    ("limit_name", "limit", "svg", "message"),
    [
        ("MAX_VECTOR_NODES", 1, '<svg><path d="M0 0L1 1"/></svg>', "nodes"),
        ("MAX_VECTOR_PATHS", 0, '<svg><path d="M0 0L1 1"/></svg>', "paths"),
        (
            "MAX_VECTOR_PATH_COMMANDS",
            1,
            '<svg><path d="M0 0L1 1"/></svg>',
            "path commands",
        ),
        ("MAX_VECTOR_SVG_BYTES", 20, '<svg><path d="M0 0L1 1"/></svg>', "bytes"),
    ],
)
def test_vector_svg_structural_caps_fail_closed(monkeypatch, limit_name, limit, svg, message):
    monkeypatch.setattr(f"worker.motifs.photo_svg.{limit_name}", limit)
    with pytest.raises(ValueError, match=message):
        _canonicalize_vtracer_svg(svg, 1, 1)


def test_photo_vectorizer_color_cap_fails_closed(monkeypatch):
    monkeypatch.setattr(
        "worker.motifs.photo_svg.vtracer.convert_pixels_to_svg",
        lambda *_args, **_kwargs: (
            '<svg><path fill="#112233" d="M0 0L1 0L1 1Z"/>'
            '<path fill="#445566" d="M0 0L0 1L1 1Z"/></svg>'
        ),
    )
    with pytest.raises(ValueError, match="2 colors after a 1-color cap"):
        photo_to_svg(
            _simple_photo(),
            "image/png",
            remove_background=False,
            simplification="medium",
            color_count=1,
        )


def test_multicolor_standalone_preview_preserves_slots_and_identity():
    raw = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
        '<path fill="#FF0000" d="M0 0H5V10H0Z"/>'
        '<path fill="#0000FF" d="M5 0H10V10H5Z"/></svg>'
    )
    first = normalize_motif_svg(raw, id_prefix="upload", render_check=False)
    second = normalize_motif_svg(first.preview_svg, id_prefix="upload", render_check=False)
    assert first.color_slots == second.color_slots == ("s0", "s1")
    assert (first.id, first.symbol, first.preview_svg) == (
        second.id,
        second.symbol,
        second.preview_svg,
    )


@pytest.mark.parametrize(
    ("limit_name", "limit", "svg", "message"),
    [
        (
            "MAX_MOTIF_SVG_BYTES",
            20,
            '<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>',
            "bytes",
        ),
        (
            "MAX_MOTIF_NODES",
            2,
            '<svg viewBox="0 0 1 1"><g><path d="M0 0L1 1"/></g></svg>',
            "nodes",
        ),
        (
            "MAX_MOTIF_PATHS",
            1,
            ('<svg viewBox="0 0 1 1"><path d="M0 0L1 0"/><path d="M0 1L1 1"/></svg>'),
            "paths",
        ),
        (
            "MAX_MOTIF_PATH_COMMANDS",
            1,
            '<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>',
            "path commands",
        ),
        (
            "MAX_MOTIF_GEOMETRY_TOKENS",
            4,
            '<svg viewBox="0 0 1 1"><path d="M0 0 1 1"/></svg>',
            "geometry",
        ),
    ],
)
def test_shared_svg_intake_caps_fail_before_geometry(monkeypatch, limit_name, limit, svg, message):
    monkeypatch.setattr(f"worker.motifs.normalize.{limit_name}", limit)
    monkeypatch.setattr(
        "worker.motifs.geometry.bbox_of",
        lambda _elements: pytest.fail("geometry must not run before intake complexity checks"),
    )
    with pytest.raises(ValueError, match=message):
        normalize_motif_svg(svg, id_prefix="upload", render_check=False)


def test_normalized_svg_output_byte_cap_fails_closed(monkeypatch):
    raw = '<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>'
    monkeypatch.setattr("worker.motifs.normalize.MAX_MOTIF_SVG_BYTES", len(raw.encode()) + 1)
    with pytest.raises(ValueError, match="normalized motif symbol"):
        normalize_motif_svg(raw, id_prefix="upload", render_check=False)


@pytest.mark.parametrize(
    ("limit_name", "limit", "svg", "message"),
    [
        (
            "MAX_MOTIF_DEPTH",
            3,
            '<svg viewBox="0 0 1 1"><g><g><path d="M0 0L1 1"/></g></g></svg>',
            "nested too deeply",
        ),
        (
            "MAX_MOTIF_GEOMETRY_TOKENS",
            4,
            '<svg viewBox="0 0 1 1"><polyline points="0 0 1 0 1 1"/></svg>',
            "geometry",
        ),
    ],
)
def test_shared_svg_depth_and_points_caps_fail_before_geometry(
    monkeypatch, limit_name, limit, svg, message
):
    monkeypatch.setattr(f"worker.motifs.normalize.{limit_name}", limit)
    monkeypatch.setattr(
        "worker.motifs.geometry.bbox_of",
        lambda _elements: pytest.fail("geometry must not run before intake complexity checks"),
    )
    with pytest.raises(ValueError, match=message):
        normalize_motif_svg(svg, id_prefix="upload", render_check=False)
