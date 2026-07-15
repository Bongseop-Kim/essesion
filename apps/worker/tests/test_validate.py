"""stage-0 intent 검증·repair 계약 — 원본 seamless-tile tests/test_intent.py 전량 이식.

worker.engine.validate(IntentInvalid, validate_intent) · worker.engine.intent(ScatterSpec) ·
worker.engine.seamless로 매핑.
"""

import copy

import pytest
from pydantic import ValidationError
from worker.engine.intent import ScatterSpec, StripeLayer, StripeParams
from worker.engine.seamless import assert_seamless_invariants
from worker.engine.validate import IntentInvalid, ValidationResult, validate_intent

from .intent_helpers import mvp_intent, register_test_motifs

register_test_motifs()


def _stripe_params(result: ValidationResult, idx: int = 1) -> StripeParams:
    """type narrowing 헬퍼 — layers[idx]가 stripe임을 확인하고 params를 반환."""
    layer = result.intent.layers[idx]
    assert isinstance(layer, StripeLayer)
    return layer.params


def test_palette_slot_count_capped():
    """A2: 상한 초과 슬롯 목록은 구조적 거부(max_length -> IntentInvalid)."""
    intent = mvp_intent()
    intent["palette"]["slots"] = [{"id": f"s{i}", "hex": "#000000"} for i in range(65)]
    with pytest.raises(IntentInvalid):
        validate_intent(intent)


def test_scatter_count_capped():
    """A2: scatter count 상한 — 한 intent가 무한 작업을 요청하지 못하게."""
    with pytest.raises(ValidationError):
        ScatterSpec(mode="poisson", min_dist_mm=1.0, count=10_001)


def test_tile_mm_ceiling_enforced():
    """A4: tile_mm은 generate 경로에서 상한(과거엔 export 전용)."""
    intent = mvp_intent()
    intent["canvas"]["tile_mm"] = 3000  # > max_tile_mm (2000)
    with pytest.raises(IntentInvalid) as exc:
        validate_intent(intent)
    assert "max_tile_mm" in str(exc.value)


def test_motif_size_exceeding_tile_rejected():
    """A7: size_mm > tile_mm은 클론 전제를 깨므로 stage-0 거부."""
    intent = mvp_intent()
    intent["layers"][2]["params"]["size_mm"] = 60.0  # tile_mm은 48
    with pytest.raises(IntentInvalid) as exc:
        validate_intent(intent)
    assert "size_mm" in str(exc.value)


def test_mvp_intent_is_valid():
    result = validate_intent(mvp_intent())
    assert result.intent.intent_version == 1
    assert len(result.intent.layers) == 4
    assert result.warnings == []


def test_removed_top_level_arrangement_field_is_rejected():
    intent = mvp_intent()
    intent["sym" + "metry"] = {"kind": "removed"}
    with pytest.raises(IntentInvalid):
        validate_intent(intent)


def test_bare_lane_on_multi_band_stripe_normalized_to_band0():
    # LLM이 다중 밴드 stripe에 bare lane("center")을 낸다 — 밴드는 네임스페이스(b0.center...)라
    # repair 없으면 compose 심층(unknown lane)에서 모든 후보가 드롭 → 불투명 500. band 0으로 정규화.
    intent = mvp_intent()
    intent["layers"][1]["params"]["bands"] = [
        {"offset_mm": 0, "width_mm": 2.4, "color": "accent"},
        {"offset_mm": 4.8, "width_mm": 2.4, "color": "accent"},
    ]
    result = validate_intent(intent)
    lanes = [
        la.placement.lane
        for la in result.intent.layers
        if la.type == "motif" and la.placement is not None
    ]
    assert lanes == ["b0.center", "b0.end"]
    assert any("normalized to 'b0.center'" in w for w in result.warnings)
    assert_seamless_invariants(result.intent)  # composes (과거: unknown lane)


def test_unknown_host_layer_rejected():
    intent = mvp_intent()
    intent["layers"][2]["placement"]["host_layer"] = "does_not_exist"
    with pytest.raises(IntentInvalid):
        validate_intent(intent)


def test_path_following_host_must_be_stripe():
    # stripe만 lanes()를 노출 — background를 host로 삼으면 compose에서 AttributeError -> 500.
    intent = mvp_intent()
    intent["layers"][2]["placement"]["host_layer"] = "ground"  # background 레이어
    with pytest.raises(IntentInvalid) as exc:
        validate_intent(intent)
    assert "must be a stripe" in str(exc.value)


@pytest.mark.parametrize("field", ["host_layer", "lane", "spacing_mm"])
def test_path_following_requires_fields(field):
    intent = mvp_intent()
    intent["layers"][2]["placement"][field] = None
    with pytest.raises(IntentInvalid) as exc:
        validate_intent(intent)
    assert field in str(exc.value)


def test_period_not_dividing_tile_rejected():
    intent = mvp_intent()
    intent["layers"][1]["params"]["period_mm"] = 25  # 48 % 25 != 0
    # repair=True는 off-grid period를 스냅(test_off_grid_stripe_period_is_snapped 참조);
    # repair가 꺼지면 불변식 거부가 그대로 적용된다.
    with pytest.raises(IntentInvalid):
        validate_intent(intent, repair=False)


def test_color_count_over_max_rejected_for_yarn_dyed():
    intent = mvp_intent()
    intent["production"] = {"method": "yarn_dyed", "max_colors": 2}  # 3 colors > 2
    with pytest.raises(IntentInvalid):
        validate_intent(intent)


def test_color_count_not_enforced_for_print():
    intent = mvp_intent()
    intent["production"] = {"method": "print", "max_colors": 2}
    # print은 색 수 제한 없음
    assert validate_intent(intent).intent.production.max_colors == 2


def test_legacy_method_digital_screen_coerced_to_print():
    intent = mvp_intent()
    # legacy print 하위 method는 "print"로 매핑(하위호환) -> 색 수 미적용
    intent["production"] = {"method": "digital", "max_colors": 2}
    assert validate_intent(intent).intent.production.method == "print"
    intent["production"] = {"method": "screen", "max_colors": 2}
    assert validate_intent(intent).intent.production.method == "print"


def test_duplicate_layer_id_rejected():
    intent = mvp_intent()
    intent["layers"][3]["id"] = "stripe_base"
    with pytest.raises(IntentInvalid):
        validate_intent(intent)


def test_motif_requires_exactly_one_color_spec():
    both = mvp_intent()
    both["layers"][2]["params"]["colors"] = {"fill": "accent"}
    with pytest.raises(IntentInvalid):
        validate_intent(both)

    neither = mvp_intent()
    del neither["layers"][2]["params"]["color"]
    with pytest.raises(IntentInvalid):
        validate_intent(neither)


def test_negative_spacing_rejected():
    intent = mvp_intent()
    intent["layers"][2]["placement"]["spacing_mm"] = -6
    with pytest.raises(IntentInvalid):
        validate_intent(intent)


def test_path_following_spacing_snapped_with_warning():
    # 대각 stripe는 3-4-5로 스냅되어 lane 폐곡선이 48*5 = 240. step 7은 240(타일 48)도 나누지
    # 못하므로 엔진은 거부 대신 스냅+경고 — 아니면 거의 모든 대각 lane이 못 쓰게 된다.
    intent = mvp_intent()
    intent["layers"][2]["placement"]["spacing_mm"] = 7
    result = validate_intent(intent)
    assert any("snapped" in w and "circle_on_stripe" in w for w in result.warnings)


def test_path_following_rejects_host_lane_and_standalone_path_together():
    intent = mvp_intent()
    intent["layers"][2]["placement"]["path"] = {"kind": "straight", "angle": 0}
    with pytest.raises(IntentInvalid, match="only one"):
        validate_intent(intent)


def test_path_following_rejects_partial_host_fields_with_standalone_path():
    intent = mvp_intent()
    intent["layers"][2]["placement"]["lane"] = None
    intent["layers"][2]["placement"]["path"] = {"kind": "straight", "angle": 0}
    with pytest.raises(IntentInvalid, match="only one"):
        validate_intent(intent)


def test_placement_rejects_spec_for_wrong_type():
    intent = mvp_intent()
    intent["layers"][2]["placement"]["lattice"] = {"cell_w_mm": 12, "cell_h_mm": 12}
    with pytest.raises(IntentInvalid, match="path_following"):
        validate_intent(intent)


def test_unknown_color_slot_rejected():
    intent = mvp_intent()
    intent["layers"][0]["params"]["color"] = "missing_slot"
    with pytest.raises(IntentInvalid):
        validate_intent(intent)


def test_dpi_clamped_on_repair():
    intent = mvp_intent()
    intent["canvas"]["dpi"] = 400
    result = validate_intent(intent, repair=True)
    assert result.intent.canvas.dpi == 300
    assert any("dpi" in w for w in result.warnings)


def test_dpi_rejected_without_repair():
    intent = mvp_intent()
    intent["canvas"]["dpi"] = 400
    with pytest.raises(IntentInvalid):
        validate_intent(intent, repair=False)


def test_unknown_top_level_field_rejected():
    intent = mvp_intent()
    intent["bogus"] = True
    with pytest.raises(IntentInvalid):
        validate_intent(intent)


def test_layer_order_is_stable_and_deterministic():
    result = validate_intent(mvp_intent())
    ordered = sorted(result.intent.layers, key=lambda layer: (layer.z_order, layer.id))
    order = [layer.id for layer in ordered]
    assert order == ["ground", "stripe_base", "circle_on_stripe", "bee_on_stripe"]
    ordered_again = sorted(result.intent.layers, key=lambda layer: (layer.z_order, layer.id))
    assert order == [layer.id for layer in ordered_again]


def test_validation_does_not_mutate_input():
    intent = mvp_intent()
    before = copy.deepcopy(intent)
    validate_intent(intent)
    assert intent == before


def test_color_resolution_is_repeatable_and_colorway_aware():
    result = validate_intent(mvp_intent())
    palette = result.palette
    assert palette.resolve_color("accent", "default") == "#ef8a7a"
    assert palette.resolve_color("accent", None) == palette.resolve_color("accent", "default")


def _full_coverage_stripe_intent() -> dict:
    """navy ground + period를 꽉 채우는 3-band silver/gold/silver stripe (3.2*3 == 9.6)
    -> stripe가 navy ground를 완전히 가린다."""
    return {
        "intent_version": 1,
        "canvas": {"tile_mm": 48, "dpi": 300},
        "seed": 0,
        "production": {"method": "digital", "max_colors": 12},
        "palette": {
            "slots": [
                {"id": "navy", "hex": "#000080"},
                {"id": "silver", "hex": "#C0C0C0"},
                {"id": "gold", "hex": "#FFD700"},
            ]
        },
        "colorways": [
            {
                "id": "default",
                "mapping": {"navy": "#000080", "silver": "#C0C0C0", "gold": "#FFD700"},
            }
        ],
        "layers": [
            {"id": "ground", "type": "background", "z_order": 0, "params": {"color": "navy"}},
            {
                "id": "stripe",
                "type": "stripe",
                "z_order": 1,
                "params": {
                    "angle": -36.87,
                    "period_mm": 9.6,
                    "bands": [
                        {"offset_mm": 0.0, "width_mm": 3.2, "color": "silver"},
                        {"offset_mm": 3.2, "width_mm": 3.2, "color": "gold"},
                        {"offset_mm": 6.4, "width_mm": 3.2, "color": "silver"},
                    ],
                },
            },
        ],
    }


def test_full_coverage_stripe_over_background_is_repaired():
    res = validate_intent(_full_coverage_stripe_intent())
    params = _stripe_params(res)
    bands = params.bands
    period = params.period_mm
    coverage = sum(b.width_mm for b in bands) / period
    assert coverage <= 0.75 + 1e-9  # 밴드가 더 이상 period를 꽉 채우지 않는다
    assert sum(b.width_mm for b in bands) < period  # ground gap이 남는다
    assert [b.color for b in bands] == ["silver", "gold", "silver"]  # 색 불변
    assert len(bands) == 3  # 밴드 수 불변
    assert any("covered the ground" in w for w in res.warnings)
    assert_seamless_invariants(res.intent)  # 여전히 tile-commensurate


def test_stripe_without_background_not_repaired():
    intent = _full_coverage_stripe_intent()
    intent["layers"] = [intent["layers"][1]]  # stripe만, 보호할 ground 없음
    intent["layers"][0]["z_order"] = 0
    res = validate_intent(intent)
    bands = _stripe_params(res, 0).bands
    assert sum(b.width_mm for b in bands) == pytest.approx(9.6)  # 손대지 않음


def test_stripe_under_cap_not_repaired():
    res = validate_intent(mvp_intent())  # 단일 밴드 4.8/9.6 = 0.5 coverage
    bands = _stripe_params(res).bands
    assert len(bands) == 1 and bands[0].width_mm == 4.8


def test_stripe_ground_gap_repair_skipped_without_repair_flag():
    res = validate_intent(_full_coverage_stripe_intent(), repair=False)
    bands = _stripe_params(res).bands
    assert sum(b.width_mm for b in bands) == pytest.approx(9.6)  # 수리 안 됨


def test_stripe_ground_gap_repair_is_deterministic():
    a = _stripe_params(validate_intent(_full_coverage_stripe_intent())).bands
    b = _stripe_params(validate_intent(_full_coverage_stripe_intent())).bands
    assert [(x.offset_mm, x.width_mm) for x in a] == [(x.offset_mm, x.width_mm) for x in b]


def test_off_grid_stripe_period_is_snapped():
    intent = _full_coverage_stripe_intent()
    intent["layers"][1]["params"]["period_mm"] = 12.0  # 3-4-5 기울기에서 tile/(5k)가 아님
    intent["layers"][1]["params"]["bands"] = [{"offset_mm": 0, "width_mm": 6.0, "color": "silver"}]
    res = validate_intent(intent)
    period = _stripe_params(res).period_mm
    assert abs(period - 9.6) < 1e-6  # 가장 가까운 commensurate(48/(5*1))로 스냅
    assert any("snapped" in w for w in res.warnings)
    assert_seamless_invariants(res.intent)  # 이제 tiling


def test_commensurate_stripe_period_not_snapped():
    res = validate_intent(mvp_intent())  # period 9.6은 이미 유효
    assert _stripe_params(res).period_mm == 9.6
    assert not any("snapped" in w for w in res.warnings)


def test_path_following_instance_budget_rejected_before_placement():
    intent = mvp_intent()
    intent["layers"][2]["placement"]["spacing_mm"] = 0.0001
    with pytest.raises(IntentInvalid, match="path_following would place"):
        validate_intent(intent)


def test_stripe_element_budget_rejected_before_render():
    intent = mvp_intent()
    intent["layers"][1]["params"] = {
        "angle": 0,
        "period_mm": 0.00048,  # 48mm / 100,000: commensurate but far over the work budget
        "bands": [{"offset_mm": 0, "width_mm": 0.00024, "color": "accent"}],
    }
    with pytest.raises(IntentInvalid, match="stripe would render"):
        validate_intent(intent)


def test_implicit_poisson_capacity_is_bounded():
    intent = mvp_intent()
    intent["layers"] = intent["layers"][:3]
    intent["layers"][2]["placement"] = {
        "type": "scatter",
        "scatter": {"mode": "poisson", "min_dist_mm": 0.0001},
    }
    with pytest.raises(IntentInvalid, match="scatter would place"):
        validate_intent(intent)


def test_subnormal_lattice_cell_is_rejected_without_overflow():
    intent = mvp_intent()
    intent["layers"] = intent["layers"][:3]
    intent["layers"][2]["placement"] = {
        "type": "lattice",
        "lattice": {"cell_w_mm": 5e-324, "cell_h_mm": 12},
    }
    with pytest.raises(IntentInvalid, match="lattice would place"):
        validate_intent(intent)
