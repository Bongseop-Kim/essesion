"""SVG 화이트리스트 게이트 (worker-engine.md §2).

sanitize_svg: 검증만 하고 **입력 문자열을 그대로 반환**(byte-stable — 엔진 출력용).
scrub_svg: 신뢰할 수 없는 외부 SVG(export 입력)를 검증 + 재직렬화.

색 허용 규칙: currentColor/none/transparent/inherit, #hex(3~8), 내부 url(#id),
그리고 스킴 없는 bare 토큰(named color·Pantone spot `"19-4024 TCX"`·`rgb(...)`)은 통과.
외부 url(...)·`javascript:`/`data:` 등 스킴 토큰은 거부(paint-server SSRF 차단).
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
COLOR_ATTRS = {"fill", "stroke", "color"}

# spec의 hex 게이트: #RGB / #RGBA / #RRGGBB / #RRGGBBAA.
HEX_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")
# 내부 paint-server 참조만 허용, 예: url(#tile).
_URL_INTERNAL_RE = re.compile(r"^url\(#[A-Za-z0-9_\-:.]+\)$")
# 엄격한 내부 프래그먼트: '#' + id 토큰 (공백/추가 토큰 불가).
_FRAGMENT_RE = re.compile(r"^#[A-Za-z_][\w.\-:]*$")


class SanitizeError(ValueError):
    """SVG에 허용 목록 밖 태그/속성/값이 있을 때. ValueError 하위 — /export가 잡는다."""


def is_internal_href(value: str) -> bool:
    """단일 내부 ``#id`` 프래그먼트에 대해서만 True (유일하게 허용되는 href 형태).

    ``#tile``은 통과하지만 ``#x javascript:y``(id 뒤 추가 토큰)·외부/스킴 URL은 거부.
    """
    return bool(_FRAGMENT_RE.match(value.strip()))


def _check_color(attr: str, value: str) -> None:
    s = value.strip()
    if not s:
        return
    low = s.lower()
    if low in ("currentcolor", "none", "transparent", "inherit"):
        return
    if s.startswith("#"):
        if not HEX_RE.match(s):
            raise SanitizeError(f"invalid hex in {attr}={value!r}")
        return
    if low.startswith("url("):
        if not _URL_INTERNAL_RE.match(s):
            raise SanitizeError(f"non-internal paint reference in {attr}={value!r}")
        return
    # url(...) 밖에서 스킴 토큰(javascript:, data:, http:) 거부.
    head = s.split("(", 1)[0]
    if ":" in head:
        raise SanitizeError(f"scheme not allowed in {attr}={value!r}")
    # bare 토큰: named color / Pantone-TCX spot / rgb(...) — 무해, 허용.


def _validate_tree(root: ET.Element) -> None:
    for elem in root.iter():
        if not isinstance(elem.tag, str):
            # 주석·PI는 비-str tag — 방어적으로 거부.
            raise SanitizeError("non-element node not allowed")
        tag = elem.tag.rsplit("}", 1)[-1]
        if tag not in ALLOWED_TAGS:
            raise SanitizeError(f"disallowed svg tag: {tag}")
        for raw_name, value in elem.attrib.items():
            name = raw_name.rsplit("}", 1)[-1]
            if name not in ALLOWED_ATTRS:
                raise SanitizeError(f"disallowed svg attr: {name}")
            if name == "href":
                if not is_internal_href(value):
                    raise SanitizeError(f"external href is not allowed: {value!r}")
            elif name in COLOR_ATTRS:
                _check_color(name, value)


def _parse(svg: str) -> ET.Element:
    if "<!DOCTYPE" in svg.upper() or "<!ENTITY" in svg.upper():
        raise SanitizeError("DTD/entity is not allowed")
    try:
        return ET.fromstring(svg)
    except ET.ParseError as exc:
        # ET.ParseError는 ValueError가 아니라 그대로 전파되면 /export의 except를 비켜간다.
        raise SanitizeError(f"unparseable SVG: {exc}") from None


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
