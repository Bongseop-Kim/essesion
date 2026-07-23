"""svg-safety allowlist 게이트의 보안 계약 — 스킴/외부 참조 거부와 byte-stability."""

import pytest
from svg_safety import SanitizeError, is_internal_href, sanitize_svg, scrub_svg

VALID = (
    '<svg xmlns="http://www.w3.org/2000/svg">'
    '<rect x="0" y="0" width="1" height="1" fill="#abc"/></svg>'
)


def test_sanitize_is_byte_stable():
    # 검증만 하고 입력을 그대로 반환해야 한다(엔진 출력의 byte-identical 계약 전제).
    assert sanitize_svg(VALID) == VALID


def test_named_and_pantone_and_internal_paint_pass():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg">'
        '<rect fill="red"/><rect fill="19-4024 TCX"/><rect fill="url(#tile)"/></svg>'
    )
    assert sanitize_svg(svg) == svg


@pytest.mark.parametrize(
    "fill",
    [
        "url(https://evil.example/x)",  # 외부 paint-server (SSRF)
        "javascript:alert(1)",
        "data:image/svg+xml,x",
    ],
)
def test_rejects_scheme_and_external_paint(fill):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="{fill}"/></svg>'
    with pytest.raises(SanitizeError):
        sanitize_svg(svg)


def test_rejects_dtd_entity_xxe():
    xxe = '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>'
    with pytest.raises(SanitizeError):
        sanitize_svg(xxe)


def test_rejects_disallowed_tag_and_attr():
    with pytest.raises(SanitizeError):
        sanitize_svg('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
    with pytest.raises(SanitizeError):
        sanitize_svg('<svg xmlns="http://www.w3.org/2000/svg"><rect onload="x"/></svg>')


def test_href_only_internal_fragment_allowed():
    assert is_internal_href("#tile") is True
    assert is_internal_href("#x javascript:y") is False
    assert is_internal_href("https://evil/x") is False
    with pytest.raises(SanitizeError):
        sanitize_svg('<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil/x"/></svg>')


def test_scrub_reserializes_and_restores_xmlns():
    out = scrub_svg('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#fff"/></svg>')
    assert 'xmlns="http://www.w3.org/2000/svg"' in out
    assert "<rect" in out
