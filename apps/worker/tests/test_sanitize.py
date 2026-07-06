"""sanitize 게이트 — SVG 인젝션 차단, 정상 엔진 출력은 무변경 통과, /export가 위험 SVG 거부.

원본 seamless-tile tests/test_sanitize.py 전량을 essesion의 색 검증 함수/정규식과
/export 라우트(경로 `/export`, essesion 문구)에 맞춰 이식.
"""

import pytest
from fastapi.testclient import TestClient
from worker.engine.generate import generate
from worker.main import app
from worker.render.sanitize import HEX_RE, SanitizeError, sanitize_svg, scrub_svg

from .intent_helpers import mvp_intent, register_test_motifs

register_test_motifs()

client = TestClient(app)

_NS = '<svg xmlns="http://www.w3.org/2000/svg"'


@pytest.mark.parametrize(
    "payload",
    [
        f"{_NS}><rect/></svg><script>alert(1)</script>",  # </svg> break-out + trailing
        f"{_NS}><script>alert(1)</script></svg>",  # script tag inside
        f'{_NS}><use href="javascript:alert(1)"/></svg>',  # javascript href
        f'{_NS}><image href="http://evil/x.png"/></svg>',  # external embedded raster
        f"{_NS}><foreignObject/></svg>",  # disallowed tag
        f'{_NS} onload="x()"><rect/></svg>',  # disallowed attribute
        f'{_NS}><rect fill="url(http://evil/p)"/></svg>',  # external paint server (SSRF)
        f'{_NS}><filter id="f"/></svg>',  # filter not in the allowlist
    ],
)
def test_sanitize_blocks_injection(payload):
    with pytest.raises(SanitizeError):
        sanitize_svg(payload)


def test_sanitize_blocks_dtd_entity_definition():
    # DTD 엔티티 정의 거부 (XXE / billion-laughs 벡터).
    xxe = f'<!DOCTYPE svg [<!ENTITY a "AAA">]>{_NS}><rect/></svg>'
    with pytest.raises(SanitizeError):
        sanitize_svg(xxe)


def test_sanitize_passes_engine_output_unchanged():
    svg = generate(mvp_intent()).svg
    assert sanitize_svg(svg) == svg  # validating gate, not a rewriter
    assert "<pattern" in svg  # enumerate-guard: tile is a <pattern>


def test_sanitize_preserves_pattern_transform_and_use_transform():
    # spec risk: 허용 목록이 정상 transform을 막으면 안 된다.
    svg = (
        f"{_NS}>"
        '<defs><symbol id="motif-x" overflow="visible">'
        '<circle cx="0" cy="0" r="0.5" fill="currentColor"/></symbol>'
        '<pattern id="tile" patternUnits="userSpaceOnUse" '
        'patternTransform="rotate(10)" width="10" height="10">'
        '<use href="#motif-x" color="#abc" transform="translate(1 2) scale(3)"/>'
        "</pattern></defs>"
        '<rect fill="url(#tile)"/></svg>'
    )
    assert sanitize_svg(svg) == svg


def test_sanitize_allows_spot_color_token():
    # resolve_color가 Pantone/TCX spot 문자열을 낼 수 있다; 인젝션이 아니다.
    svg = f'{_NS}><rect fill="19-4024 TCX"/></svg>'
    assert sanitize_svg(svg) == svg


@pytest.mark.parametrize(
    "value,ok",
    [
        ("#abc", True),
        ("#abcd", True),
        ("#aabbcc", True),
        ("#aabbccdd", True),
        ("#xyz", False),
        ("#12", False),
        ("aabbcc", False),
    ],
)
def test_hex_regex(value, ok):
    assert bool(HEX_RE.match(value)) is ok


def test_export_route_rejects_unsafe_svg_400():
    bad = f'{_NS}><image href="http://evil/x.png"/></svg>'
    resp = client.post("/export", json={"svg": bad, "dpi": 300, "width_mm": 48})
    assert resp.status_code == 400
    assert "image" in str(resp.json()["detail"]).lower()  # essesion: "disallowed svg tag: image"


def test_export_route_rejects_script_breakout_400():
    bad = f"{_NS}><rect/></svg><script>alert(1)</script>"
    resp = client.post("/export", json={"svg": bad, "dpi": 300, "width_mm": 48})
    assert resp.status_code == 400


@pytest.mark.parametrize(
    "payload",
    [
        # xlink:href가 안전한 plain href 뒤에 위험 값을 숨긴다 (양쪽 순서).
        f'{_NS} xmlns:xlink="http://www.w3.org/1999/xlink">'
        '<use xlink:href="javascript:evil" href="#safe"/></svg>',
        f'{_NS} xmlns:xlink="http://www.w3.org/1999/xlink">'
        '<use href="#safe" xlink:href="javascript:evil"/></svg>',
        # custom-ns paint가 안전한 fill을 가린다 -> 외부 paint-server가 살아남을 수 있다.
        f'{_NS} xmlns:z="urn:z"><rect z:fill="url(http://evil)" fill="#fff"/></svg>',
    ],
)
def test_sanitize_blocks_namespaced_attribute_collision(payload):
    with pytest.raises(SanitizeError):
        sanitize_svg(payload)


def test_sanitize_allows_lone_internal_xlink_href():
    # 단일 네임스페이스 내부 참조는 정상 — 무변경 통과.
    svg = f'{_NS} xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#tile"/></svg>'
    assert sanitize_svg(svg) == svg


def test_sanitize_blocks_lone_external_xlink_href():
    # 가리는 형제가 없으면 href로 접혀 허용 목록 게이트가 거부한다.
    svg = f'{_NS} xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="http://evil"/></svg>'
    with pytest.raises(SanitizeError):
        sanitize_svg(svg)


def test_scrub_svg_drops_comments_and_pi():
    svg = (
        f"{_NS}><!--<script>x</script>--><?php evil ?>"
        '<rect width="1" height="1" fill="#abc"/></svg>'
    )
    out = scrub_svg(svg)
    assert "<!--" not in out and "<?php" not in out  # 비-element 노드 제거
    assert "<rect" in out and 'xmlns="http://www.w3.org/2000/svg"' in out
    assert sanitize_svg(out) == out  # scrub 출력 자체가 다시 검증 통과


def test_scrub_svg_blocks_injection_and_collision():
    with pytest.raises(SanitizeError):
        scrub_svg(f"{_NS}><script>x</script></svg>")
    with pytest.raises(SanitizeError):
        scrub_svg(
            f'{_NS} xmlns:xlink="http://www.w3.org/1999/xlink">'
            '<use xlink:href="javascript:e" href="#s"/></svg>'
        )


def test_sanitize_allows_rgb_and_internal_url_color_tokens():
    # 정상 rgb() 색과 내부 url(#id) paint 참조는 통과해야 한다.
    svg = f'{_NS}><rect fill="rgb(1,2,3)" stroke="url(#tile)"/></svg>'
    assert sanitize_svg(svg) == svg
