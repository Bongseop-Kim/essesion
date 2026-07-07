"""normalize → motif_id 원본 parity — "같은 입력 → 같은 id" 계약 (worker-motifs.md §2).

기대 id는 원본 seamless-tile의 `normalize_motif_svg`를 recraft_samples 픽스처에
실행해 추출한 값(2026-07-07, render_check=False). 재구현이 프레이밍·slotify·해시 입력
어느 하나라도 다르게 계산하면 여기서 갈라진다.
"""

from pathlib import Path

import pytest
from worker.motifs.normalize import normalize_motif_svg

_FIXTURES = Path(__file__).parent / "fixtures" / "recraft_samples"

# (stem, 원본 motif_id, 원본 color_slots)
_EXPECTED = [
    ("honeybee_top", "recraft-6922bc0e3284", ("s0", "s1", "s2", "s3")),
    ("pelican_bicycle_side", "recraft-aabff336b478", ("s0", "s1", "s2", "s3", "s4", "s5")),
    ("pig_face_flat", "recraft-b226a66c1475", ("s0", "s1", "s2")),
]


@pytest.mark.parametrize("stem,expected_id,expected_slots", _EXPECTED)
def test_normalize_produces_original_motif_id(stem, expected_id, expected_slots):
    svg = (_FIXTURES / f"{stem}.svg").read_text()
    motif = normalize_motif_svg(svg, render_check=False)
    assert motif.id == expected_id
    assert motif.color_slots == expected_slots


@pytest.mark.parametrize("stem,expected_id,expected_slots", _EXPECTED)
def test_normalize_is_idempotent_on_id(stem, expected_id, expected_slots):
    svg = (_FIXTURES / f"{stem}.svg").read_text()
    assert normalize_motif_svg(svg, render_check=False).id == expected_id  # 재실행 동일
