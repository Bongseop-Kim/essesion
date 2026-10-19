"""배치형(panel) — 블레이드에 한 번 놓이는 요소 (worker-engine.md §2b)."""

import copy

import pytest
from worker.engine import compose_design
from worker.engine.constraints import ConstraintInvalid
from worker.engine.determinism import layout_id_for
from worker.engine.patch import set_motif_slot
from worker.engine.validate import IntentInvalid, validate_intent
from worker.motifs.registry import iter_motif_ids

from .intent_helpers import mvp_intent, register_test_motifs

register_test_motifs()

PANEL = [
    {
        "type": "region",
        "points": [[0, 300], [1000, -200], [1000, 1600], [0, 1600]],
        "color": "accent",
    },
    {"type": "line", "points": [[0, 500], [1000, 0]], "width": 12, "color": "gold", "end_dot": 30},
    {
        "type": "curve_band",
        "points": [[900, -400], [600, 300], [200, 600], [0, 1100]],
        "width": 60,
        "color": "gold",
    },
    {
        "type": "motif",
        "motif_id": "bee",
        "at": [890, 980],
        "size": 140,
        "role": "logo",
        "anchor": "bottom_right",
    },
]


def _with_panel() -> dict:
    return {**mvp_intent(), "panel": copy.deepcopy(PANEL)}


def test_no_panel_leaves_design_unchanged():
    design = compose_design(mvp_intent())
    assert design.panel_svg is None
    assert "panel" not in validate_intent(mvp_intent()).intent.model_dump(exclude_none=True)
    # panel을 더해도 타일은 그대로다 — panel은 별도 문서다.
    assert compose_design(_with_panel()).svg == design.svg


def test_panel_compose_is_deterministic_and_once():
    first = compose_design(_with_panel()).panel_svg
    assert first is not None and first == compose_design(_with_panel()).panel_svg
    assert first.count("<polygon") == 1 and first.count("<use") == 1
    assert 'viewBox="0 -4600 1000 6200"' in first
    assert "<pattern" not in first


def test_panel_colors_follow_colorway():
    raw = _with_panel()
    hexes = {cw["id"]: cw["mapping"]["accent"] for cw in raw["colorways"]}
    for colorway, accent in hexes.items():
        assert accent in compose_design(raw, colorway=colorway).panel_svg


def test_panel_layout_id_differs_only_with_panel():
    plain = validate_intent(mvp_intent()).intent
    panelled = validate_intent(_with_panel()).intent
    assert layout_id_for(plain) != layout_id_for(panelled)


def test_panel_validation():
    bad = _with_panel()
    bad["panel"][0]["color"] = "nope"
    with pytest.raises(IntentInvalid):
        validate_intent(bad)
    two_logos = _with_panel()
    two_logos["panel"].append(copy.deepcopy(PANEL[-1]))
    with pytest.raises(IntentInvalid):
        validate_intent(two_logos)


def test_iter_motif_ids_includes_panel():
    assert "bee" in iter_motif_ids(_with_panel())


def test_set_motif_slot_logo_replaces_panel_logo_only():
    raw = _with_panel()
    out = set_motif_slot(raw, slot="logo", motif_id="circle")
    assert out["panel"][-1]["motif_id"] == "circle"
    assert out["layers"] == raw["layers"]
    assert raw["panel"][-1]["motif_id"] == "bee"  # 원본 불변
    with pytest.raises(ConstraintInvalid):
        set_motif_slot(mvp_intent(), slot="logo", motif_id="circle")


def test_layer_slot_swap_keeps_panel_and_its_colors():
    raw = _with_panel()
    out = set_motif_slot(raw, slot=2, motif_id="circle")
    assert out["panel"] == raw["panel"]
    compose_design(out)  # panel 색 슬롯이 팔레트 정리에서 살아남는다
