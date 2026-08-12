import base64
import hashlib
import io
from pathlib import Path

import pytest
from PIL import Image
from svg_safety import parse_svg_tree
from worker.motifs.normalize import normalize_motif_svg
from worker.motifs.photo_svg import (
    canonicalize_vtracer_svg,
    decode_user_image,
    photo_to_svg,
    quantize_intermediate_colors,
    threshold_alpha,
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


def _multicolor_photo() -> bytes:
    image = Image.new("RGB", (128, 128), "white")
    colors = [
        (255, 0, 0),
        (255, 136, 0),
        (255, 255, 0),
        (0, 255, 0),
        (0, 0, 255),
        (85, 0, 136),
        (153, 0, 204),
        (0, 0, 0),
    ]
    for index, color in enumerate(colors):
        for y in range(32, 96):
            for x in range(24 + index * 10, 34 + index * 10):
                image.putpixel((x, y), color)
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


def test_photo_vectorization_removes_flat_border_and_returns_png_preview():
    result = photo_to_svg(
        _simple_photo(),
        "image/png",
        remove_background=True,
    )
    assert result.background_confidence is not None and result.background_confidence >= 0.55
    assert "<path" in result.svg
    assert "#DD1122" in result.svg
    assert "#FFFFFF" not in result.svg
    assert result.warnings
    repeated = photo_to_svg(
        _simple_photo(),
        "image/png",
        remove_background=True,
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
    )
    assert kept.background_confidence is None
    assert "#FFFFFF" in kept.svg and "#DD1122" in kept.svg

    with pytest.raises(ValueError, match="empty or frame-filling"):
        photo_to_svg(
            _simple_photo(flat=True),
            "image/png",
            remove_background=True,
        )


def test_photo_vectorization_preserves_a_legitimate_eight_color_motif():
    result = photo_to_svg(
        _multicolor_photo(),
        "image/png",
        remove_background=True,
    )

    fills = {
        value.lower()
        for element in parse_svg_tree(result.svg).iter()
        if (value := element.get("fill")) is not None and value.startswith("#")
    }

    assert len(fills) == 8


def test_photo_mime_is_verified_from_bytes():
    with pytest.raises(ValueError, match="does not match"):
        decode_user_image(_simple_photo(), "image/jpeg")


def test_alpha_threshold_drops_semitransparent_antialiasing():
    image = Image.new("RGBA", (3, 1))
    image.putdata([(1, 2, 3, 0), (1, 2, 3, 254), (1, 2, 3, 255)])

    assert list(threshold_alpha(image).getchannel("A").get_flattened_data()) == [0, 0, 255]


def test_intermediate_color_quantization_ignores_hidden_rgb():
    white_hidden = Image.new("RGBA", (32, 32), (255, 255, 255, 0))
    black_hidden = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    for image in (white_hidden, black_hidden):
        for y in range(8, 24):
            for x in range(8, 16):
                image.putpixel((x, y), (220, 20, 40, 255))
            for x in range(16, 24):
                image.putpixel((x, y), (20, 120, 60, 255))

    first = quantize_intermediate_colors(white_hidden)
    second = quantize_intermediate_colors(black_hidden)

    assert first.tobytes() == second.tobytes()


def test_generated_motif_quantization_keeps_more_than_six_distinct_flat_colors():
    image = Image.new("RGBA", (8, 1), (255, 255, 255, 0))
    colors = [
        (255, 0, 0, 255),
        (255, 136, 0, 255),
        (255, 255, 0, 255),
        (0, 255, 0, 255),
        (0, 0, 255, 255),
        (85, 0, 136, 255),
        (153, 0, 204, 255),
        (0, 0, 0, 255),
    ]
    image.putdata(colors)

    quantized = quantize_intermediate_colors(image)
    visible = {
        pixel[:3]
        for pixel in quantized.get_flattened_data()
        if isinstance(pixel, tuple) and pixel[3] > 0
    }

    assert len(visible) == len(colors)


def test_generated_motif_quantization_only_merges_nearby_intermediate_colors():
    image = Image.new("RGBA", (3, 1))
    image.putdata(
        [
            (100, 100, 100, 255),
            (105, 105, 105, 255),
            (220, 20, 40, 255),
        ]
    )

    quantized = quantize_intermediate_colors(image)
    visible = {
        pixel[:3]
        for pixel in quantized.get_flattened_data()
        if isinstance(pixel, tuple) and pixel[3] > 0
    }

    assert len(visible) == 2


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
        canonicalize_vtracer_svg(svg, 1, 1)


def test_photo_vectorizer_snaps_synthesized_colors_back_to_quantized_palette(monkeypatch):
    monkeypatch.setattr(
        "worker.motifs.photo_svg.vtracer.convert_pixels_to_svg",
        lambda *_args, **_kwargs: (
            '<svg><path fill="#112233" d="M0 0L1 0L1 1Z"/>'
            '<path fill="#F0F0F0" d="M0 0L0 1L1 1Z"/></svg>'
        ),
    )
    result = photo_to_svg(
        _simple_photo(),
        "image/png",
        remove_background=False,
    )

    fills = {
        value
        for element in parse_svg_tree(result.svg).iter()
        if (value := element.get("fill")) is not None
    }
    assert fills == {"#DD1122", "#FFFFFF"}


def test_multicolor_standalone_preview_preserves_paints_and_identity():
    raw = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
        '<path fill="#FF0000" d="M0 0H5V10H0Z"/>'
        '<path fill="#0000FF" d="M5 0H10V10H5Z"/></svg>'
    )
    first = normalize_motif_svg(raw, id_prefix="upload", render_check=False)
    second = normalize_motif_svg(first.preview_svg, id_prefix="upload", render_check=False)
    assert "#ff0000" in first.preview_svg and "#0000ff" in first.preview_svg
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
