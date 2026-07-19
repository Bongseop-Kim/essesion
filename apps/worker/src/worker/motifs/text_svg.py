"""Deterministic short text/initials to path-only SVG conversion."""

from __future__ import annotations

import math
import re
import threading
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Literal, Protocol, cast

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

from worker.engine.units import fmt

MAX_TEXT_MOTIF_LENGTH = 20
MAX_TEXT_PATH_COMMANDS = 20_000
MAX_TEXT_SVG_BYTES = 2_000_000

_FONTS = {
    ("nanum-gothic", 400): "NanumGothic-Regular.ttf",
    ("nanum-gothic", 700): "NanumGothic-Bold.ttf",
    ("nanum-myeongjo", 400): "NanumMyeongjo-Regular.ttf",
    ("nanum-myeongjo", 700): "NanumMyeongjo-Bold.ttf",
}
_FONT_DIR = Path(__file__).with_name("fonts")
_FONT_LOCK = threading.Lock()
_PATH_COMMAND = re.compile(r"[A-Za-z]")


class _HeadTable(Protocol):
    unitsPerEm: int


def _allowed_character(char: str) -> bool:
    codepoint = ord(char)
    return (
        char == " "
        or "A" <= char <= "Z"
        or "a" <= char <= "z"
        or "0" <= char <= "9"
        or 0xAC00 <= codepoint <= 0xD7A3
        or 0x3131 <= codepoint <= 0x318E
    )


@lru_cache(maxsize=len(_FONTS))
def _font(font_id: str, font_weight: int) -> TTFont:
    try:
        filename = _FONTS[(font_id, font_weight)]
    except KeyError:
        raise ValueError("unsupported motif font or weight") from None
    return TTFont(
        _FONT_DIR / filename,
        lazy=False,
        recalcBBoxes=False,
        recalcTimestamp=False,
    )


def normalize_text_motif_input(text: str) -> str:
    normalized = unicodedata.normalize("NFC", text)
    if not normalized or not normalized.strip():
        raise ValueError("text motif must contain a visible character")
    if len(normalized) > MAX_TEXT_MOTIF_LENGTH:
        raise ValueError(f"text motif must be at most {MAX_TEXT_MOTIF_LENGTH} characters")
    invalid = [char for char in normalized if not _allowed_character(char)]
    if invalid:
        rendered = " ".join(f"U+{ord(char):04X}" for char in invalid[:5])
        raise ValueError(f"text motif contains unsupported characters: {rendered}")
    return normalized


def text_to_svg(
    text: str,
    *,
    font_id: Literal["nanum-gothic", "nanum-myeongjo"],
    font_weight: Literal[400, 700],
    letter_spacing: float = 0.0,
) -> str:
    """Convert text to one deterministic SVG path; no `<text>` or external font survives."""

    normalized = normalize_text_motif_input(text)
    if not math.isfinite(letter_spacing) or not -0.2 <= letter_spacing <= 1.0:
        raise ValueError("letter_spacing must be between -0.2 and 1.0 em")

    with _FONT_LOCK:
        font = _font(font_id, font_weight)
        glyph_set = font.getGlyphSet()
        cmap = font.getBestCmap() or {}
        units_per_em = int(cast(_HeadTable, font["head"]).unitsPerEm)
        metrics = font["hmtx"].metrics
        spacing_units = letter_spacing * units_per_em
        path_pen = SVGPathPen(glyph_set)
        bounds_pen = BoundsPen(glyph_set)
        cursor = 0.0
        for index, char in enumerate(normalized):
            glyph_name = cmap.get(ord(char))
            if glyph_name is None:
                raise ValueError(f"selected font has no glyph for U+{ord(char):04X}")
            transform = Transform(1, 0, 0, -1, cursor, 0)
            glyph = glyph_set[glyph_name]
            glyph.draw(TransformPen(path_pen, transform))
            glyph.draw(TransformPen(bounds_pen, transform))
            cursor += metrics[glyph_name][0]
            if index < len(normalized) - 1:
                cursor += spacing_units

        commands = path_pen.getCommands()
        bounds = bounds_pen.bounds

    if not commands or bounds is None:
        raise ValueError("text motif produced no visible path")
    command_count = len(_PATH_COMMAND.findall(commands))
    if command_count > MAX_TEXT_PATH_COMMANDS:
        raise ValueError(
            f"text motif path complexity {command_count} exceeds {MAX_TEXT_PATH_COMMANDS}"
        )
    min_x, min_y, max_x, max_y = bounds
    width, height = max_x - min_x, max_y - min_y
    if width <= 0 or height <= 0:
        raise ValueError("text motif path has degenerate bounds")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{fmt(min_x)} {fmt(min_y)} {fmt(width)} {fmt(height)}">'
        f'<path fill="#111111" d="{commands}"/></svg>'
    )
    if len(svg.encode("utf-8")) > MAX_TEXT_SVG_BYTES:
        raise ValueError(f"text motif SVG exceeds {MAX_TEXT_SVG_BYTES} bytes")
    return svg
