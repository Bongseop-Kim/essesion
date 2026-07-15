"""기존 worker import 경로를 유지하는 공용 SVG sanitizer 호환 모듈."""

from svg_safety import (
    ALLOWED_ATTRS,
    HEX_RE,
    SanitizeError,
    _validate_tree,
    parse_svg_tree,
    sanitize_svg,
    scrub_svg,
)

__all__ = [
    "ALLOWED_ATTRS",
    "HEX_RE",
    "SanitizeError",
    "_validate_tree",
    "parse_svg_tree",
    "sanitize_svg",
    "scrub_svg",
]
