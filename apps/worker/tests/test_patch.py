"""구성 patch 단위 테스트 — 축별 적용/미적용, 모티프 불변, 결정론 (design-redesign 2단계)."""

import pytest
from worker.engine.candidates import compose_design
from worker.engine.constraints import ConstraintInvalid, PaletteConstraint
from worker.engine.patch import DesignPatchV1, apply_patch, composition_snapshot

from .intent_helpers import mvp_intent, register_test_motifs

register_test_motifs()


def _patch(**fields) -> DesignPatchV1:
    return DesignPatchV1.model_validate({"note": "테스트", **fields})


def _lattice_intent() -> dict:
    """격자 모티프 1개 + 배경 — 배치·크기 축 검증용."""
    return {
        "intent_version": 1,
        "canvas": {"tile_mm": 48, "dpi": 300},
        "seed": 7,
        "production": {"method": "print", "max_colors": 12},
        "palette": {
            "slots": [{"id": "ground", "hex": "#FFFFFF"}, {"id": "color_1", "hex": "#000080"}]
        },
        "colorways": [
            {"id": "default", "mapping": {"ground": "#FFFFFF", "color_1": "#000080"}},
        ],
        "layers": [
            {"id": "ground", "type": "background", "z_order": 0, "params": {"color": "ground"}},
            {
                "id": "motif_0",
                "type": "motif",
                "z_order": 1,
                "params": {"motif_id": "circle", "size_mm": 6.0, "color": "color_1"},
                "placement": {"type": "lattice", "lattice": {"cell_w_mm": 8.0, "cell_h_mm": 8.0}},
            },
        ],
    }


def _slot_hex(intent: dict, slot_id: str) -> str:
    return next(slot["hex"] for slot in intent["palette"]["slots"] if slot["id"] == slot_id)


def test_patch_schema_has_no_motif_identity_field():
    assert "motif_id" not in DesignPatchV1.model_json_schema(mode="serialization")["properties"]
    with pytest.raises(ValueError, match="extra"):
        DesignPatchV1.model_validate({"note": "x", "motif_id": "bee"})


def test_snapshot_round_trips_the_patchable_axes_without_motif_identity():
    snapshot = composition_snapshot(_lattice_intent())

    assert snapshot["background"] == {"color": "#FFFFFF"}
    assert snapshot["placement"] == {
        "arrangement": "lattice",
        "count_per_axis": 6,
        "rotation_deg": None,
    }
    assert snapshot["motif_size_mm"] == [6.0]
    assert snapshot["palette"]["slots"] == [
        {"id": "ground", "hex": "#FFFFFF", "roles": ["background"]},
        {"id": "color_1", "hex": "#000080", "roles": ["motif"]},
    ]
    assert "circle" not in repr(snapshot)


def test_background_patch_recolors_the_ground_slot_and_its_colorway():
    patched = apply_patch(_lattice_intent(), _patch(background={"color": "f5f0e6"}))

    assert _slot_hex(patched, "ground") == "#F5F0E6"
    assert patched["colorways"][0]["mapping"]["ground"] == "#F5F0E6"
    assert _slot_hex(patched, "color_1") == "#000080"


def test_background_patch_does_not_recolor_a_slot_shared_with_the_stripes():
    shared = _lattice_intent()
    shared["layers"].insert(
        1,
        {
            "id": "stripe_0",
            "type": "stripe",
            "z_order": 1,
            "params": {
                "angle": 0.0,
                "period_mm": 12.0,
                # 밴드가 배경 슬롯을 그대로 쓴다 — 배경만 바꿔야 한다.
                "bands": [{"offset_mm": 0.0, "width_mm": 4.0, "color": "ground"}],
            },
        },
    )

    patched = apply_patch(shared, _patch(background={"color": "#F5F0E6"}))

    band_slot = patched["layers"][1]["params"]["bands"][0]["color"]
    bg_slot = patched["layers"][0]["params"]["color"]
    assert bg_slot != band_slot
    assert _slot_hex(patched, bg_slot) == "#F5F0E6"
    assert _slot_hex(patched, band_slot) == "#FFFFFF"
    assert patched["colorways"][0]["mapping"][bg_slot] == "#F5F0E6"


def test_placement_patch_derives_scatter_density_from_the_axis_count():
    patched = apply_patch(
        _lattice_intent(), _patch(placement={"arrangement": "scatter", "count_per_axis": 4})
    )

    placement = patched["layers"][1]["placement"]
    assert placement["type"] == "scatter"
    assert placement["scatter"] == {"mode": "poisson", "min_dist_mm": 12.0, "count": 8}


def test_motif_color_paints_every_slot_including_original_color_motifs():
    base = mvp_intent()
    # 원본색을 유지하는 여러 색 무늬 — 슬롯 참조가 아니라 직접 hex다.
    base["layers"][2]["params"] = {
        "motif_id": "circle",
        "size_mm": 1.4,
        "colors": {"s0": "#112233", "s1": "#445566"},
    }

    patched = apply_patch(base, _patch(motif_color="#C81E1E"))

    slot_id = patched["layers"][2]["params"]["colors"]["s0"]
    assert set(patched["layers"][2]["params"]["colors"]) == {"s0", "s1"}
    assert patched["layers"][2]["params"]["colors"]["s1"] == slot_id
    assert _slot_hex(patched, slot_id) == "#C81E1E"
    # 단일 슬롯 무늬는 color 필드로 남는다.
    assert patched["layers"][3]["params"]["color"] == slot_id
    assert "colors" not in patched["layers"][3]["params"]


def test_null_axes_leave_everything_else_untouched():
    base = _lattice_intent()

    patched = apply_patch(base, _patch(motif_size_mm=[4.0]))

    assert patched["layers"][1]["params"]["size_mm"] == 4.0
    assert patched["layers"][1]["placement"] == base["layers"][1]["placement"]
    assert patched["palette"] == base["palette"]
    assert patched["layers"][1]["params"]["motif_id"] == "circle"


def test_placement_patch_keeps_lattice_cells_dividing_the_tile():
    patched = apply_patch(
        _lattice_intent(), _patch(placement={"arrangement": "staggered", "count_per_axis": 5})
    )

    placement = patched["layers"][1]["placement"]
    # 엇갈림은 짝수 축으로 올림 — (tile/cell)*0.5가 정수여야 토러스에서 닫힌다.
    assert placement["lattice"] == {
        "cell_w_mm": 8.0,
        "cell_h_mm": 8.0,
        "drop_fraction": 0.5,
        "drop_axis": "column",
    }
    assert 48 / placement["lattice"]["cell_w_mm"] == 6


def test_rotation_only_patch_keeps_the_current_placement_type():
    patched = apply_patch(mvp_intent(), _patch(placement={"rotation_deg": -45.0}))

    for layer in patched["layers"][2:]:
        assert layer["placement"]["type"] == "path_following"
        assert layer["placement"]["fixed_rotation_deg"] == -45.0
        assert layer["placement"]["rotation"] == "fixed"


def test_stripe_patch_normalizes_bands_into_the_period_and_allocates_slots():
    patched = apply_patch(
        mvp_intent(),
        _patch(
            stripe={
                "period_mm": 9.6,
                "bands": [
                    {"offset_mm": 12.0, "width_mm": 30.0, "color": "#D4AF37"},
                    {"offset_mm": 4.0, "width_mm": 2.0, "color": "#ef8a7a"},
                ],
            }
        ),
    )

    bands = patched["layers"][1]["params"]["bands"]
    assert bands[0]["offset_mm"] == 2.4  # 12 % 9.6
    assert bands[0]["width_mm"] == 9.6  # period로 클램프
    # 새 hex는 슬롯을 하나 얻고, 이미 있는 hex는 그 슬롯을 재사용한다.
    assert _slot_hex(patched, bands[0]["color"]) == "#D4AF37"
    assert bands[1]["color"] == "accent"


def test_period_only_patch_renormalizes_the_existing_bands():
    patched = apply_patch(mvp_intent(), _patch(stripe={"period_mm": 2.4}))

    band = patched["layers"][1]["params"]["bands"][0]
    assert patched["layers"][1]["params"]["period_mm"] == 2.4
    assert band["width_mm"] == 2.4  # 기존 4.8은 새 period로 클램프
    assert band["color"] == "accent"


def test_stripe_patch_adds_a_stripe_layer_above_the_background():
    patched = apply_patch(
        _lattice_intent(),
        _patch(
            stripe={
                "angle": 0.0,
                "period_mm": 12.0,
                "bands": [{"offset_mm": 0.0, "width_mm": 4.0, "color": "#000080"}],
            }
        ),
    )

    assert [layer["type"] for layer in patched["layers"]] == ["background", "stripe", "motif"]
    assert [layer["z_order"] for layer in patched["layers"]] == [0, 1, 2]


def test_empty_bands_remove_the_stripes_unless_a_motif_path_hosts_them():
    solid = _lattice_intent()
    solid["layers"].insert(
        1,
        {
            "id": "stripe_0",
            "type": "stripe",
            "z_order": 1,
            "params": {
                "angle": 0.0,
                "period_mm": 12.0,
                "bands": [{"offset_mm": 0.0, "width_mm": 4.0, "color": "color_1"}],
            },
        },
    )

    patched = apply_patch(solid, _patch(stripe={"bands": []}))
    assert [layer["type"] for layer in patched["layers"]] == ["background", "motif"]

    with pytest.raises(ConstraintInvalid, match="host motif paths"):
        apply_patch(mvp_intent(), _patch(stripe={"bands": []}))


def test_unreferenced_slots_are_pruned_so_edits_do_not_grow_the_palette():
    base = _lattice_intent()
    base["palette"]["slots"].append({"id": "color_2", "hex": "#D4AF37"})
    base["colorways"][0]["mapping"]["color_2"] = "#D4AF37"
    base["layers"].insert(
        1,
        {
            "id": "stripe_0",
            "type": "stripe",
            "z_order": 1,
            "params": {
                "angle": 0.0,
                "period_mm": 12.0,
                "bands": [{"offset_mm": 0.0, "width_mm": 4.0, "color": "color_2"}],
            },
        },
    )

    patched = apply_patch(
        base,
        _patch(stripe={"bands": [{"offset_mm": 0.0, "width_mm": 4.0, "color": "#123456"}]}),
    )

    slot_ids = {slot["id"] for slot in patched["palette"]["slots"]}
    assert "color_2" not in slot_ids  # 밴드만 쓰던 슬롯 — 참조가 끊겼다
    assert set(patched["colorways"][0]["mapping"]) == slot_ids
    assert len(slot_ids) == 3


def test_fixed_palette_conflict_is_a_constraint_error():
    constraint = PaletteConstraint(mode="fixed", colors=["#FFFFFF", "#000080"])

    with pytest.raises(ConstraintInvalid, match="outside the fixed palette"):
        apply_patch(
            _lattice_intent(),
            _patch(background={"color": "#D4AF37"}),
            palette_constraint=constraint,
        )
    # 강제 팔레트 안의 색은 그대로 통과한다.
    assert (
        _slot_hex(
            apply_patch(
                _lattice_intent(),
                _patch(background={"color": "#000080"}),
                palette_constraint=constraint,
            ),
            "ground",
        )
        == "#000080"
    )


def test_same_intent_and_patch_render_byte_identical_svg():
    patch = _patch(
        background={"color": "#F5F0E6"},
        placement={"arrangement": "lattice", "count_per_axis": 4},
        motif_size_mm=[9.0],
    )
    first = compose_design(apply_patch(_lattice_intent(), patch))
    second = compose_design(apply_patch(_lattice_intent(), patch))

    assert first.svg == second.svg
    assert first.id == second.id
