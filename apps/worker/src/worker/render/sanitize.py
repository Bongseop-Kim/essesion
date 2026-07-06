"""SVG 화이트리스트 게이트 (worker-engine.md §2).

sanitize_svg: 검증만 하고 **입력 문자열을 그대로 반환**(byte-stable — 엔진 출력용).
scrub_svg: 신뢰할 수 없는 외부 SVG(export 입력)를 검증 + 재직렬화.
"""

import re
import xml.etree.ElementTree as ET

ALLOWED_TAGS = {
    "svg",
    "defs",
    "symbol",
    "pattern",
    "g",
    "rect",
    "line",
    "circle",
    "ellipse",
    "use",
    "path",
    "polygon",
    "polyline",
}
ALLOWED_ATTRS = {
    "xmlns",
    "width",
    "height",
    "viewBox",
    "id",
    "overflow",
    "patternUnits",
    "patternTransform",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "points",
    "d",
    "fill",
    "stroke",
    "stroke-width",
    "color",
    "opacity",
    "transform",
    "href",
}
COLOR_RE = re.compile(r"^(currentColor|none|transparent|inherit|#[0-9a-fA-F]{3,8}|url\(#[-\w]+\))$")


def _validate_tree(root: ET.Element) -> None:
    for elem in root.iter():
        tag = elem.tag.rsplit("}", 1)[-1]
        if tag not in ALLOWED_TAGS:
            raise ValueError(f"disallowed svg tag: {tag}")
        for raw_name, value in elem.attrib.items():
            name = raw_name.rsplit("}", 1)[-1]
            if name not in ALLOWED_ATTRS:
                raise ValueError(f"disallowed svg attr: {name}")
            if name in {"fill", "stroke", "color"} and not COLOR_RE.match(value):
                raise ValueError(f"disallowed color: {value}")
            if name == "href" and not value.startswith("#"):
                raise ValueError("external href is not allowed")


def _parse(svg: str) -> ET.Element:
    if "<!DOCTYPE" in svg.upper() or "<!ENTITY" in svg.upper():
        raise ValueError("DTD/entity is not allowed")
    return ET.fromstring(svg)


def sanitize_svg(svg: str) -> str:
    """검증 통과 시 입력 그대로 반환 — 재직렬화 금지(byte-identical의 전제)."""
    _validate_tree(_parse(svg))
    return svg


def scrub_svg(svg: str) -> str:
    """신뢰 불가 SVG(export 입력) — 검증 후 재직렬화해 원문 인젝션을 차단."""
    root = _parse(svg)
    _validate_tree(root)
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    return ET.tostring(root, encoding="unicode")
