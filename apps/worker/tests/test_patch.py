"""구성 patch 단위 테스트 — 축별 적용/미적용, 모티프 불변, 결정론 (design-redesign 2단계)."""

import pytest
from worker.engine.compose import compose_design
from worker.engine.constraints import ConstraintInvalid, apply_generation_constraints
from worker.engine.patch import DesignPatchV1, apply_patch, composition_snapshot, set_motif_slot
from worker.engine.seamless import assert_seamless_invariants
from worker.engine.validate import validate_intent

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
        "palette": {"slots": [{"id": "ground", "hex": "#FFFFFF"}]},
        "colorways": [
            {"id": "default", "mapping": {"ground": "#FFFFFF"}},
        ],
        "layers": [
            {"id": "ground", "type": "background", "z_order": 0, "params": {"color": "ground"}},
            {
                "id": "motif_0",
                "type": "motif",
                "z_order": 1,
                "params": {"motif_id": "circle", "size_mm": 6.0},
                "placement": {"type": "lattice", "lattice": {"cell_w_mm": 8.0, "cell_h_mm": 8.0}},
            },
        ],
    }


def _slot_hex(intent: dict, slot_id: str) -> str:
    return next(slot["hex"] for slot in intent["palette"]["slots"] if slot["id"] == slot_id)


def test_patch_schema_has_no_motif_identity_field():
    properties = DesignPatchV1.model_json_schema(mode="serialization")["properties"]
    assert "motif_id" not in properties
    assert "motif_color" not in properties
    with pytest.raises(ValueError, match="extra"):
        DesignPatchV1.model_validate({"note": "x", "motif_id": "bee"})
    with pytest.raises(ValueError, match="extra"):
        DesignPatchV1.model_validate({"note": "x", "motif_color": "#000080"})


def test_changed_axes_lists_only_the_set_axes():
    """admin 진단(`diagnostics.patch_axes`)과 거절 판정이 같은 목록을 본다."""
    assert _patch().changed_axes == []
    assert not _patch().has_changes
    patch = _patch(background={"color": "#FFFFFF"}, motif_size_mm=[4.0])
    assert patch.changed_axes == ["background", "motif_size_mm"]
    assert patch.has_changes


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
    ]
    assert "circle" not in repr(snapshot)


def test_background_patch_recolors_the_ground_slot_and_its_colorway():
    patched = apply_patch(_lattice_intent(), _patch(background={"color": "f5f0e6"}))

    assert _slot_hex(patched, "ground") == "#F5F0E6"
    assert patched["colorways"][0]["mapping"]["ground"] == "#F5F0E6"


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


def test_placement_patch_keeps_the_two_motif_slots_staggered():
    """배치를 바꿔도 슬롯 2의 반 칸 위상이 살아 있어야 한다 — 0이면 두 모티프가 정확히 포개진다."""
    two_slots = set_motif_slot(_lattice_intent(), slot=2, motif_id="circle")
    assert two_slots["layers"][2]["placement"]["lattice"]["offset_x_mm"] == 4.0

    patched = apply_patch(two_slots, _patch(placement={"count_per_axis": 4}))

    first, second = (layer["placement"]["lattice"] for layer in patched["layers"][1:3])
    assert first.get("offset_x_mm", 0.0) == 0.0
    assert second["offset_x_mm"] == first["cell_w_mm"] / 2
    assert second["offset_y_mm"] == first["cell_h_mm"] / 2


def test_placement_patch_yields_density_so_the_clamp_never_shrinks_the_motif():
    """조사 3→4턴 재생 — 크기를 안 건드린 patch는 밀도를 낮춰 14mm를 지킨다."""
    base = _lattice_intent()
    base["layers"][1]["params"]["size_mm"] = 14.0

    third = apply_patch(base, _patch(placement={"arrangement": "lattice", "count_per_axis": 10}))
    fourth = apply_patch(third, _patch(placement={"arrangement": "staggered", "count_per_axis": 8}))

    for patched in (third, fourth):
        warnings: list[str] = []
        constrained = apply_generation_constraints(patched, warnings=warnings)
        # 클램프가 애초에 일어나지 않으므로 원래 크기가 그대로 남는다.
        assert warnings == []
        assert constrained["layers"][1]["params"]["size_mm"] == 14.0

    # 크기를 함께 바꾼 patch는 지금처럼 요청한 밀도를 그대로 받는다.
    dense = apply_patch(base, _patch(placement={"count_per_axis": 10}, motif_size_mm=[4.0]))
    assert 48 / dense["layers"][1]["placement"]["lattice"]["cell_w_mm"] == 10


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
                "bands": [{"offset_mm": 0.0, "width_mm": 4.0, "color": "ground"}],
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
    assert len(slot_ids) == 2


def test_scale_multiplies_every_length_without_triggering_the_period_resnap():
    """seamless-log e20b99e9 재발 방지 — 균일 배율은 불변식을 보존해 재스냅이 안 걸린다."""
    patched = apply_patch(mvp_intent(), _patch(scale=1.5))

    assert patched["canvas"]["tile_mm"] == 72.0
    stripe = patched["layers"][1]["params"]
    assert stripe["period_mm"] == 14.4
    assert stripe["bands"][0]["width_mm"] == 7.2
    assert stripe["angle"] == -36.87  # 각도 불변
    assert patched["layers"][2]["params"]["size_mm"] == 2.1
    assert patched["layers"][2]["placement"]["spacing_mm"] == 9.0

    result = validate_intent(patched)
    assert result.warnings == []
    assert_seamless_invariants(result.intent)


def test_scale_keeps_lattice_invariants():
    patched = apply_patch(_lattice_intent(), _patch(scale=1.5))

    lattice = patched["layers"][1]["placement"]["lattice"]
    assert patched["canvas"]["tile_mm"] == 72.0
    assert lattice == {"cell_w_mm": 12.0, "cell_h_mm": 12.0}
    result = validate_intent(patched)
    assert result.warnings == []
    assert_seamless_invariants(result.intent)


def test_scale_clamps_cumulatively_at_the_tile_ceiling():
    warnings: list[str] = []
    once = apply_patch(mvp_intent(), _patch(scale=4.0), warnings=warnings)
    assert once["canvas"]["tile_mm"] == 192.0
    assert warnings == []

    twice = apply_patch(once, _patch(scale=4.0), warnings=warnings)
    assert twice["canvas"]["tile_mm"] == 192.0
    assert len(warnings) == 1 and "192" in warnings[0]


def test_changed_axes_includes_scale():
    assert _patch(scale=1.5).changed_axes == ["scale"]


def test_snapshot_exposes_the_scale_headroom():
    snapshot = composition_snapshot(mvp_intent())
    assert snapshot["scale"] == {"current": 1.0, "min": 0.25, "max": 4.0}

    grown = apply_patch(mvp_intent(), _patch(scale=2.0))
    assert composition_snapshot(grown)["scale"] == {"current": 2.0, "min": 0.25, "max": 2.0}


def test_off_grid_period_scales_the_tile_instead_of_resnapping():
    """백스톱 — 모델이 scale 대신 period로 확대를 표현해도 요청이 조용히 원복되지 않는다."""
    patched = apply_patch(mvp_intent(), _patch(stripe={"period_mm": 14.4}))

    # 14.4는 tile 48에서 off-grid(48/(k·5) ∉ {14.4}) — period가 아니라 tile이 1.5배 된다.
    assert patched["canvas"]["tile_mm"] == 72.0
    assert patched["layers"][1]["params"]["period_mm"] == 14.4
    assert patched["layers"][2]["params"]["size_mm"] == 2.1  # 모티프도 함께 배율
    result = validate_intent(patched)
    assert result.warnings == []
    assert_seamless_invariants(result.intent)


def test_off_grid_period_keeps_asymmetric_bands_verbatim():
    """밴드별 확대("빨간 밴드만 1.5배")가 전부-f배로 뭉개지지 않는다."""
    patched = apply_patch(
        mvp_intent(),
        _patch(
            stripe={
                "period_mm": 14.4,
                "bands": [
                    {"offset_mm": 0.0, "width_mm": 7.2, "color": "#ef8a7a"},
                    {"offset_mm": 7.2, "width_mm": 2.4, "color": "#D4AF37"},
                ],
            }
        ),
    )

    assert patched["canvas"]["tile_mm"] == 72.0
    bands = patched["layers"][1]["params"]["bands"]
    assert [band["width_mm"] for band in bands] == [7.2, 2.4]
    assert bands[1]["offset_mm"] == 7.2
    result = validate_intent(patched)
    # 다중 밴드가 되며 bare lane 정규화 경고는 남지만 period 재스냅은 없어야 한다.
    assert not any("snapped" in warning for warning in result.warnings)
    assert_seamless_invariants(result.intent)


def test_scale_with_motif_size_keeps_the_motif_at_its_absolute_size():
    """ "줄무늬 굵게 + 모티프는 그대로" = scale + motif_size_mm=[현재값]."""
    patched = apply_patch(mvp_intent(), _patch(scale=1.5, motif_size_mm=[1.4, 5.0]))

    assert patched["canvas"]["tile_mm"] == 72.0
    assert patched["layers"][1]["params"]["period_mm"] == 14.4
    assert patched["layers"][2]["params"]["size_mm"] == 1.4
    assert patched["layers"][3]["params"]["size_mm"] == 5.0


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
