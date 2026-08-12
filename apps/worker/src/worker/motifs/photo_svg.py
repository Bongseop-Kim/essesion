"""Local, deterministic photo simplification and VTracer vectorization.

The background separator is intentionally bounded to flat, border-connected backgrounds. It
fails with an explicit confidence error instead of pretending to segment arbitrary photographs.
All CPU-heavy work in this module is called through FastAPI's thread pool.
"""

from __future__ import annotations

import base64
import io
import math
import statistics
import xml.etree.ElementTree as ET
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, cast

import vtracer
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError
from svg_safety import ALLOWED_ATTRS, ALLOWED_TAGS, parse_svg_tree

from worker.engine.constraints import normalize_hex
from worker.engine.palette import hex_to_rgb
from worker.motifs.normalize import (
    MAX_MOTIF_NODES,
    MAX_MOTIF_PATH_COMMANDS,
    MAX_MOTIF_PATHS,
    MAX_MOTIF_SVG_BYTES,
)

MAX_PHOTO_PIXELS = 20_000_000
MAX_VECTOR_SIDE = 1_024
MAX_VECTOR_NODES = MAX_MOTIF_NODES
MAX_VECTOR_PATHS = MAX_MOTIF_PATHS
MAX_VECTOR_PATH_COMMANDS = MAX_MOTIF_PATH_COMMANDS
MAX_VECTOR_SVG_BYTES = MAX_MOTIF_SVG_BYTES
MAX_PROCESSED_PREVIEW_BYTES = 2_000_000

_PATH_COMMANDS = frozenset("MmLlHhVvCcSsQqTtAaZz")
RGB = tuple[int, int, int]
RGBA = tuple[int, int, int, int]
SIMPLIFICATION_PRESETS = {
    "low": {
        "filter_speckle": 2,
        "color_precision": 8,
        "layer_difference": 8,
        "corner_threshold": 50,
        "length_threshold": 3.5,
        "max_iterations": 10,
        "splice_threshold": 40,
        "path_precision": 3,
    },
    "medium": {
        "filter_speckle": 4,
        "color_precision": 6,
        "layer_difference": 16,
        "corner_threshold": 60,
        "length_threshold": 4.0,
        "max_iterations": 10,
        "splice_threshold": 45,
        "path_precision": 3,
    },
    "high": {
        "filter_speckle": 8,
        "color_precision": 4,
        "layer_difference": 32,
        "corner_threshold": 75,
        "length_threshold": 6.0,
        "max_iterations": 8,
        "splice_threshold": 60,
        "path_precision": 2,
    },
}


@dataclass(frozen=True)
class PhotoMotifResult:
    svg: str
    processed_preview_base64: str
    background_confidence: float | None
    warnings: list[str]


def decode_user_image(data: bytes, declared_type: str) -> Image.Image:
    if declared_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError("image type is not supported")
    expected = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[declared_type]
    try:
        with Image.open(io.BytesIO(data)) as source:
            if source.width * source.height > MAX_PHOTO_PIXELS:
                raise ValueError("image has too many pixels")
            if source.format != expected:
                raise ValueError("image content does not match its declared type")
            source.load()
            return ImageOps.exif_transpose(source).convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("image could not be decoded") from exc


def _border_indices(width: int, height: int) -> list[int]:
    indices = list(range(width))
    if height > 1:
        indices.extend((height - 1) * width + x for x in range(width))
    indices.extend(y * width for y in range(1, height - 1))
    if width > 1:
        indices.extend(y * width + width - 1 for y in range(1, height - 1))
    return indices


def remove_flat_border_background(image: Image.Image) -> tuple[Image.Image, float]:
    width, height = image.size
    pixels = list(cast(Sequence[RGBA], image.get_flattened_data()))
    total = width * height
    if total == 0:
        raise ValueError("image is empty")
    border = _border_indices(width, height)

    # Existing alpha is authoritative and does not need color inference.
    transparent = sum(pixels[index][3] < 16 for index in border)
    if transparent >= max(1, round(len(border) * 0.5)):
        foreground = sum(pixel[3] >= 16 for pixel in pixels)
        fraction = foreground / total
        if not 0.01 <= fraction <= 0.90:
            raise ValueError("transparent image has an empty or frame-filling subject")
        return image, 1.0

    border_rgb = [pixels[index][:3] for index in border]
    background = tuple(int(statistics.median(channel)) for channel in zip(*border_rgb, strict=True))

    def distance(rgb: tuple[int, int, int]) -> float:
        return math.sqrt(
            sum((value - target) ** 2 for value, target in zip(rgb, background, strict=True))
        )

    deviations = sorted(distance(rgb) for rgb in border_rgb)
    p90 = deviations[min(len(deviations) - 1, round((len(deviations) - 1) * 0.9))]
    threshold = min(70.0, max(18.0, p90 + 12.0))
    seeds = [index for index in border if distance(pixels[index][:3]) <= threshold]
    seed_fraction = len(seeds) / len(border)
    uniformity = max(0.0, 1.0 - p90 / 80.0)
    confidence = round(0.65 * seed_fraction + 0.35 * uniformity, 4)
    if seed_fraction < 0.65 or confidence < 0.55:
        raise ValueError(
            "automatic separation supports flat border-connected backgrounds; "
            f"background confidence {confidence:.2f} is too low"
        )

    background_mask = bytearray(total)
    queue: deque[int] = deque()
    for index in seeds:
        if not background_mask[index]:
            background_mask[index] = 1
            queue.append(index)
    while queue:
        index = queue.popleft()
        x, y = index % width, index // width
        for neighbor in (
            index - 1 if x else -1,
            index + 1 if x + 1 < width else -1,
            index - width if y else -1,
            index + width if y + 1 < height else -1,
        ):
            if neighbor < 0 or background_mask[neighbor]:
                continue
            if distance(pixels[neighbor][:3]) <= threshold:
                background_mask[neighbor] = 1
                queue.append(neighbor)

    foreground_count = total - sum(background_mask)
    foreground_fraction = foreground_count / total
    if not 0.01 <= foreground_fraction <= 0.90:
        raise ValueError(
            "automatic separation produced an empty or frame-filling subject; "
            "use a flatter background or keep the background"
        )
    alpha = Image.new("L", image.size)
    alpha.putdata([0 if is_background else 255 for is_background in background_mask])
    alpha = alpha.filter(ImageFilter.MedianFilter(3))
    separated = image.copy()
    separated.putalpha(alpha)
    return separated, confidence


def threshold_alpha(image: Image.Image, threshold: int = 255) -> Image.Image:
    """Make alpha binary, treating anti-aliased semi-transparent pixels as background."""
    if not 1 <= threshold <= 255:
        raise ValueError("alpha threshold must be between 1 and 255")
    output = image.convert("RGBA")
    alpha_lut = [255 if value >= threshold else 0 for value in range(256)]
    output.putalpha(output.getchannel("A").point(alpha_lut))
    return output


def quantize_image(image: Image.Image, color_count: int) -> Image.Image:
    # Fully transparent pixels still carry RGB values. Build the palette from visible pixels only
    # so an invisible background neither pollutes nor consumes one of the requested color slots.
    source = Image.new("RGBA", image.size, (255, 255, 255, 0))
    source.alpha_composite(image.convert("RGBA"))
    alpha = source.getchannel("A")
    pixels = cast(Sequence[RGBA], source.get_flattened_data())
    visible = [cast(RGB, pixel[:3]) for pixel in pixels if pixel[3] > 0]
    if not visible:
        return source

    foreground = Image.new("RGB", (len(visible), 1))
    foreground.putdata(visible)
    reduced = foreground.quantize(
        colors=color_count,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )
    colors = sorted(set(cast(Sequence[RGB], reduced.convert("RGB").get_flattened_data())))
    fixed_palette = Image.new("P", (1, 1))
    fixed_palette.putpalette(
        [channel for index in range(256) for channel in colors[index % len(colors)]]
    )
    quantized = source.convert("RGB").quantize(
        palette=fixed_palette,
        dither=Image.Dither.NONE,
    )
    output = quantized.convert("RGBA")
    output.putalpha(alpha)
    return output


def _preview_png(image: Image.Image) -> bytes:
    for side in (MAX_VECTOR_SIDE, 768, 512, 384):
        preview = image.copy()
        preview.thumbnail((side, side), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        preview.save(output, format="PNG", optimize=True)
        data = output.getvalue()
        if len(data) <= MAX_PROCESSED_PREVIEW_BYTES:
            return data
    raise ValueError(f"processed preview exceeds {MAX_PROCESSED_PREVIEW_BYTES} bytes")


def canonicalize_vtracer_svg(raw_svg: str, width: int, height: int) -> str:
    if len(raw_svg.encode("utf-8")) > MAX_VECTOR_SVG_BYTES:
        raise ValueError(f"vectorized SVG exceeds {MAX_VECTOR_SVG_BYTES} bytes")
    root = parse_svg_tree(raw_svg)
    if root.tag != "svg":
        raise ValueError("vectorizer did not return an SVG root")

    def remove_non_elements(parent: ET.Element) -> None:
        for child in list(parent):
            if not isinstance(child.tag, str):
                parent.remove(child)
            else:
                remove_non_elements(child)

    remove_non_elements(root)
    root.attrib = {
        "xmlns": "http://www.w3.org/2000/svg",
        "viewBox": f"0 0 {width} {height}",
    }
    nodes = list(root.iter())
    if len(nodes) > MAX_VECTOR_NODES:
        raise ValueError(f"vectorized SVG has {len(nodes)} nodes (max {MAX_VECTOR_NODES})")
    paths = 0
    path_commands = 0
    for element in nodes:
        tag = element.tag.rsplit("}", 1)[-1]
        if tag not in ALLOWED_TAGS:
            raise ValueError(f"vectorizer returned unsupported SVG tag {tag!r}")
        for name, value in element.attrib.items():
            local = name.rsplit("}", 1)[-1]
            if local not in ALLOWED_ATTRS:
                raise ValueError(f"vectorizer returned unsupported SVG attribute {local!r}")
            if local in {"fill", "stroke"} and value.startswith("#"):
                normalize_hex(value)
        if tag == "path":
            paths += 1
            path_commands += sum(char in _PATH_COMMANDS for char in element.get("d", ""))
    if paths == 0:
        raise ValueError("vectorizer produced no paths")
    if paths > MAX_VECTOR_PATHS:
        raise ValueError(f"vectorized SVG has {paths} paths (max {MAX_VECTOR_PATHS})")
    if path_commands > MAX_VECTOR_PATH_COMMANDS:
        raise ValueError(
            f"vectorized SVG has {path_commands} path commands (max {MAX_VECTOR_PATH_COMMANDS})"
        )
    svg = ET.tostring(root, encoding="unicode")
    if len(svg.encode("utf-8")) > MAX_VECTOR_SVG_BYTES:
        raise ValueError(f"vectorized SVG exceeds {MAX_VECTOR_SVG_BYTES} bytes")
    return svg


def trace_quantized_image(
    image: Image.Image,
    *,
    simplification: Literal["low", "medium", "high"],
    color_count: int,
) -> str:
    """Trace a quantized RGBA image and enforce the shared SVG complexity budget."""
    if not 1 <= color_count <= 6:
        raise ValueError("color_count must be between 1 and 6")
    pixels = list(cast(Sequence[RGBA], image.get_flattened_data()))
    palette = sorted({pixel[:3] for pixel in pixels if pixel[3] > 0})
    if not palette:
        raise ValueError("quantized image has no visible colors")
    if len(palette) > color_count:
        raise ValueError(
            f"quantized image has {len(palette)} visible colors after a {color_count}-color cap"
        )
    params = SIMPLIFICATION_PRESETS[simplification]
    raw_svg = vtracer.convert_pixels_to_svg(
        pixels,
        image.size,
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        **params,
    )
    svg = canonicalize_vtracer_svg(raw_svg, *image.size)
    root = parse_svg_tree(svg)
    for element in root.iter():
        for key, value in element.attrib.items():
            if key.rsplit("}", 1)[-1] not in {"fill", "stroke"} or not value.startswith("#"):
                continue
            traced = hex_to_rgb(normalize_hex(value))
            nearest = min(
                palette,
                key=lambda color: sum(
                    (channel - target) ** 2 for channel, target in zip(color, traced, strict=True)
                ),
            )
            element.set(key, "#" + "".join(f"{channel:02X}" for channel in nearest))
    return ET.tostring(root, encoding="unicode")


def photo_to_svg(
    data: bytes,
    declared_type: str,
    *,
    remove_background: bool,
    simplification: Literal["low", "medium", "high"],
    color_count: int,
) -> PhotoMotifResult:
    if not 1 <= color_count <= 6:
        raise ValueError("color_count must be between 1 and 6")
    image = decode_user_image(data, declared_type)
    image.thumbnail((MAX_VECTOR_SIDE, MAX_VECTOR_SIDE), Image.Resampling.LANCZOS)
    confidence: float | None = None
    warnings: list[str] = []
    if remove_background:
        image, confidence = remove_flat_border_background(image)
        warnings.append("automatic separation is limited to flat border-connected backgrounds")
    image = quantize_image(image, color_count)
    preview = _preview_png(image)
    svg = trace_quantized_image(image, simplification=simplification, color_count=color_count)
    return PhotoMotifResult(
        svg=svg,
        processed_preview_base64=base64.b64encode(preview).decode("ascii"),
        background_confidence=confidence,
        warnings=warnings,
    )
