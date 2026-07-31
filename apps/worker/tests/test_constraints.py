import pytest
from pydantic import ValidationError
from worker.engine import compose_design
from worker.engine.constraints import (
    ConstraintInvalid,
    PaletteConstraint,
    PatternConstraints,
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
    pattern = PatternConstraints()
    constrained = apply_generation_constraints(mvp_intent(), palette=palette, pattern=pattern)

    assert constrained["colorways"] == [
        {
            "id": "default",
            "name": "fixed",
            "mapping": {"ground": "#112233", "accent": "#DDEEFF", "gold": "#112233"},
        }
    ]
    assert "spot" not in constrained["palette"]["slots"][0]
    assert_constraints_satisfied(constrained, palette=palette, pattern=pattern)


def test_fixed_palette_fails_when_authored_layers_do_not_use_every_color():
    raw = mvp_intent()
    raw["layers"] = raw["layers"][:2]
    palette = PaletteConstraint(mode="fixed", colors=["#111111", "#222222", "#333333"])
    with pytest.raises(ConstraintInvalid, match="at least 3 color slots"):
        apply_generation_constraints(raw, palette=palette, pattern=PatternConstraints())


def test_pattern_controls_map_to_physical_engine_primitives_and_lock_variants():
    palette = PaletteConstraint()
    pattern = PatternConstraints(
        motif_scale="large", density="dense", arrangement="staggered", direction="vertical"
    )
    constrained = apply_generation_constraints(mvp_intent(), palette=palette, pattern=pattern)
    assert constrained["layers"][1]["params"]["angle"] == 90.0
    for layer in constrained["layers"][2:]:
        # large(48*0.28=13.44)는 dense 셀(6.0)의 1.15배로 클램프된다
        assert layer["params"]["size_mm"] == 6.9
        assert layer["placement"]["type"] == "lattice"
        assert layer["placement"]["lattice"] == {
            "cell_w_mm": 6.0,
            "cell_h_mm": 6.0,
            "drop_fraction": 0.5,
            "drop_axis": "column",
        }
        assert layer["placement"]["fixed_rotation_deg"] == 90.0

    design = compose_design(
        constrained,
        palette_constraint=palette,
        pattern_constraints=pattern,
    )
    assert_constraints_satisfied(design.intent, palette=palette, pattern=pattern)
    assert "rotate(90)" in design.svg


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
        pattern=PatternConstraints(),
        warnings=warnings,
    )
    assert constrained["layers"][1]["params"]["size_mm"] == 13.8  # 12.0 × 1.15
    assert warnings == ["layer 'motif_0': size_mm 14.4 clamped to 13.8 (lattice cell 12.0 × 1.15)"]

    # 상한 이하의 의도적 밀집은 건드리지 않는다
    warnings.clear()
    untouched = apply_generation_constraints(
        _lattice_intent(13.0, 4),
        palette=PaletteConstraint(),
        pattern=PatternConstraints(),
        warnings=warnings,
    )
    assert untouched["layers"][1]["params"]["size_mm"] == 13.0
    assert warnings == []


@pytest.mark.parametrize("scale", ["small", "medium", "large"])
@pytest.mark.parametrize("density", ["sparse", "medium", "dense"])
def test_scale_and_density_together_never_exceed_the_overlap_allowance(scale, density):
    """S7 회귀: 크기·밀도를 함께 지정한 9조합 모두 셀의 1.15배 이하."""
    palette = PaletteConstraint()
    pattern = PatternConstraints(motif_scale=scale, density=density, arrangement="lattice")
    constrained = apply_generation_constraints(
        _lattice_intent(5.0, 4), palette=palette, pattern=pattern
    )
    layer = constrained["layers"][1]
    cell = min(layer["placement"]["lattice"][key] for key in ("cell_w_mm", "cell_h_mm"))
    assert layer["params"]["size_mm"] <= cell * 1.15 + 1e-9
    # 클램프가 걸려도 사후 검증(motif_scale)과 충돌하지 않는다
    assert_constraints_satisfied(constrained, palette=palette, pattern=pattern)
    design = compose_design(constrained, palette_constraint=palette, pattern_constraints=pattern)
    for layer in design.intent.model_dump()["layers"][1:]:
        cells = layer["placement"]["lattice"]
        limit = min(cells["cell_w_mm"], cells["cell_h_mm"]) * 1.15
        assert layer["params"]["size_mm"] <= limit + 1e-9


def test_direction_constraint_rejects_malformed_layers():
    raw = mvp_intent()
    raw["layers"] = {}

    with pytest.raises(ConstraintInvalid, match="selected direction requires intent.layers"):
        apply_generation_constraints(
            raw,
            palette=PaletteConstraint(),
            pattern=PatternConstraints(direction="vertical"),
        )
