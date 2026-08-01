import pytest
from pydantic import ValidationError
from worker.engine import compose_design
from worker.engine.constraints import (
    ConstraintInvalid,
    PaletteConstraint,
    apply_generation_constraints,
    assert_constraints_satisfied,
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


def test_fixed_palette_normalizes_deduplicates_and_rejects_too_few_colors():
    palette = PaletteConstraint(mode="fixed", colors=["#abc", "#123456", "#AABBCC"])
    assert palette.colors == ["#AABBCC", "#123456"]
    with pytest.raises(ValidationError, match="2 to 5 distinct colors"):
        PaletteConstraint(mode="fixed", colors=["#abc", "#AABBCC"])


def test_fixed_palette_is_applied_to_used_slots_and_collapses_colorways():
    palette = PaletteConstraint(mode="fixed", colors=["#112233", "#ddeeff"])
    constrained = apply_generation_constraints(mvp_intent(), palette=palette)

    assert constrained["colorways"] == [
        {
            "id": "default",
            "name": "fixed",
            "mapping": {"ground": "#112233", "accent": "#DDEEFF", "gold": "#112233"},
        }
    ]
    assert "spot" not in constrained["palette"]["slots"][0]
    assert_constraints_satisfied(constrained, palette=palette)


def test_fixed_palette_fails_when_authored_layers_do_not_use_every_color():
    raw = mvp_intent()
    raw["layers"] = raw["layers"][:2]
    palette = PaletteConstraint(mode="fixed", colors=["#111111", "#222222", "#333333"])
    with pytest.raises(ConstraintInvalid, match="at least 3 color slots"):
        apply_generation_constraints(raw, palette=palette)


def _lattice_intent(size_mm: float, columns: int) -> dict:
    """저작 모델이 내보내는 모양: size_ratio와 columns가 서로를 모르는 격자 한 장."""
    raw = mvp_intent()
    raw["layers"] = raw["layers"][:1] + [
        {
            "id": "motif_0",
            "type": "motif",
            "z_order": 1,
            "params": {"motif_id": "circle", "size_mm": size_mm, "color": "accent"},
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
    constrained = apply_generation_constraints(
        _lattice_intent(14.4, 4),
        palette=PaletteConstraint(),
        warnings=warnings,
    )
    assert constrained["layers"][1]["params"]["size_mm"] == 13.8  # 12.0 × 1.15
    assert warnings == ["layer 'motif_0': size_mm 14.4 clamped to 13.8 (lattice cell 12.0 × 1.15)"]

    # 상한 이하의 의도적 밀집은 건드리지 않는다
    warnings.clear()
    untouched = apply_generation_constraints(
        _lattice_intent(13.0, 4),
        palette=PaletteConstraint(),
        warnings=warnings,
    )
    assert untouched["layers"][1]["params"]["size_mm"] == 13.0
    assert warnings == []


def test_clamped_lattice_design_still_composes_and_satisfies_the_fixed_palette():
    """4축을 없앤 뒤에도 남는 두 기계 — 팔레트 강제와 겹침 클램프 — 가 함께 동작한다."""
    palette = PaletteConstraint(mode="fixed", colors=["#112233", "#ddeeff"])
    constrained = apply_generation_constraints(_lattice_intent(30.0, 4), palette=palette)
    assert constrained["layers"][1]["params"]["size_mm"] == 13.8  # 12.0 × 1.15
    design = compose_design(constrained, palette_constraint=palette)
    assert_constraints_satisfied(design.intent, palette=palette)
