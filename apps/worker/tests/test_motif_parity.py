"""고정색 normalize 결정론의 최소 회귀 기준선 (worker-motifs.md §2).

seamless-tile의 슬롯화 ID와 byte parity는 더 이상 공식 계약이 아니다. 한 픽스처만 남겨
구체 색을 포함한 essesion 정규화 결과의 결정론을 고정한다. 다색·currentColor 동작은
`test_motif_normalize.py`에서 직접 검증한다.
"""

from pathlib import Path

import pytest
from worker.motifs.normalize import normalize_motif_svg

_FIXTURES = Path(__file__).parent / "fixtures" / "provider_samples"

# (stem, essesion fixed-color motif_id)
_EXPECTED = [
    ("honeybee_top", "fixture-f0ea70370e3d"),
]


@pytest.mark.parametrize("stem,expected_id", _EXPECTED)
def test_normalize_produces_fixed_color_motif_id(stem, expected_id):
    svg = (_FIXTURES / f"{stem}.svg").read_text()
    motif = normalize_motif_svg(svg, id_prefix="fixture", render_check=False)
    assert motif.id == expected_id
    assert "currentColor" not in motif.symbol
