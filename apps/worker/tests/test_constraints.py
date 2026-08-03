import pytest
from worker.engine import compose_design
from worker.engine.constraints import (
    apply_generation_constraints,
    normalize_hex,
)

from .intent_helpers import mvp_intent, register_test_motifs

register_test_motifs()


def test_normalize_hex_tolerates_missing_hash_and_canonicalizes():
    assert normalize_hex("00008b") == "#00008B"  # bare hex from the authoring model
    assert normalize_hex("#00008b") == "#00008B"
    assert normalize_hex("abc") == "#AABBCC"
    with pytest.raises(ValueError, match="#RGB or #RRGGBB"):
        normalize_hex("navy")
    with pytest.raises(ValueError, match="#RGB or #RRGGBB"):
        normalize_hex("##00008b")  # a doubled prefix is malformed, not bare hex


def _lattice_intent(size_mm: float, columns: int) -> dict:
    """저작 모델이 내보내는 모양: size_ratio와 columns가 서로를 모르는 격자 한 장."""
    raw = mvp_intent()
    raw["layers"] = raw["layers"][:1] + [
        {
            "id": "motif_0",
            "type": "motif",
            "z_order": 1,
            "params": {"motif_id": "circle", "size_mm": size_mm},
            "placement": {
                "type": "lattice",
                "lattice": {"cell_w_mm": 48 / columns, "cell_h_mm": 48 / columns},
            },
        }
    ]
    return raw


def test_lattice_motif_larger_than_cell_is_clamped_with_a_warning():
    warnings: list[str] = []
    # S4 회귀: size_ratio 0.3 · columns 4 → 셀 12mm에 14.4mm 모티프 (로고 형상 파괴)
    constrained = apply_generation_constraints(_lattice_intent(14.4, 4), warnings=warnings)
    assert constrained["layers"][1]["params"]["size_mm"] == 13.8  # 12.0 × 1.15
    assert warnings == ["layer 'motif_0': size_mm 14.4 clamped to 13.8 (lattice cell 12.0 × 1.15)"]

    # 상한 이하의 의도적 밀집은 건드리지 않는다
    warnings.clear()
    untouched = apply_generation_constraints(_lattice_intent(13.0, 4), warnings=warnings)
    assert untouched["layers"][1]["params"]["size_mm"] == 13.0
    assert warnings == []


def test_clamped_lattice_design_still_composes():
    """4축을 없앤 뒤 남는 유일한 기계 — 겹침 클램프 — 를 통과한 intent가 그대로 합성된다."""
    raw = _lattice_intent(30.0, 4)
    raw["layers"].insert(1, mvp_intent()["layers"][1])
    constrained = apply_generation_constraints(raw)
    assert constrained["layers"][2]["params"]["size_mm"] == 13.8  # 12.0 × 1.15
    design = compose_design(constrained)
    assert design.svg.startswith("<svg")
