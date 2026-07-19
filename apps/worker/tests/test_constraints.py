import pytest
from pydantic import ValidationError
from worker.engine import generate_candidates
from worker.engine.constraints import (
    ConstraintInvalid,
    PaletteConstraint,
    PatternConstraints,
    apply_generation_constraints,
    assert_constraints_satisfied,
)

from .intent_helpers import mvp_intent, register_test_motifs

register_test_motifs()


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
        assert layer["params"]["size_mm"] == 13.44
        assert layer["placement"]["type"] == "lattice"
        assert layer["placement"]["lattice"] == {
            "cell_w_mm": 6.0,
            "cell_h_mm": 6.0,
            "drop_fraction": 0.5,
            "drop_axis": "column",
        }
        assert layer["placement"]["fixed_rotation_deg"] == 90.0

    candidates = generate_candidates(
        constrained,
        candidate_count=8,
        palette_constraint=palette,
        pattern_constraints=pattern,
    )
    assert candidates.candidates
    for candidate in candidates.candidates:
        assert_constraints_satisfied(candidate.intent, palette=palette, pattern=pattern)
        assert "rotate(90)" in candidate.candidate.svg

