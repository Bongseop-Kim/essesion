"""모티프 레이어 자리 비우기(avoid_layer) — 엔진 필터·검증·patch 보존·플랜 서수 변환."""

import copy
import re

import pytest
from worker.design_plan.compiler import compile_design_plan_v3
from worker.design_plan.schema import DesignPlanV3, snapshot_resolved_plan, structural_fingerprint
from worker.engine.compose import compose_design
from worker.engine.patch import DesignPatchV1, apply_patch
from worker.engine.validate import IntentInvalid

from .intent_helpers import register_test_motifs

register_test_motifs()


def _intent(*, avoid: str | None = "logo") -> dict:
    """8mm 격자 점 36개 위에 대각선 로고 2개 — 로고 자리 점만 빠져야 한다."""
    dots: dict = {"type": "lattice", "lattice": {"cell_w_mm": 8.0, "cell_h_mm": 8.0}}
    if avoid is not None:
        dots["avoid_layer"] = avoid
    return {
        "intent_version": 1,
        "canvas": {"tile_mm": 48, "dpi": 300},
        "seed": 0,
        "production": {"method": "print", "max_colors": 12},
        "palette": {"slots": [{"id": "ground", "hex": "#FFFFFF"}]},
        "colorways": [{"id": "default", "mapping": {"ground": "#FFFFFF"}}],
        "layers": [
            {"id": "ground", "type": "background", "z_order": 0, "params": {"color": "ground"}},
            {
                "id": "logo",
                "type": "motif",
                "z_order": 1,
                "params": {"motif_id": "bee", "size_mm": 6.0},
                "placement": {"type": "point_set", "point_set": {"points": [[8, 8], [32, 32]]}},
            },
            {
                "id": "dots",
                "type": "motif",
                "z_order": 2,
                "params": {"motif_id": "circle", "size_mm": 2.0},
                "placement": dots,
            },
        ],
    }


def _uses(svg: str, motif_id: str) -> int:
    return len(re.findall(f'href="#motif-{motif_id}"', svg))


def test_avoid_drops_only_overlapping_instances():
    plain = compose_design(_intent(avoid=None))
    avoided = compose_design(_intent())

    # reach=(6+2)/2=4mm — 로고 중심 점만 겹친다(이웃 점은 8mm 떨어져 있다). 두 점 다
    # 경계에서 멀어 클론이 없으니 <use>는 정확히 2개 준다.
    assert _uses(avoided.svg, "circle") == _uses(plain.svg, "circle") - 2
    assert _uses(avoided.svg, "bee") == _uses(plain.svg, "bee")
    assert avoided.warnings == []


def test_avoid_is_deterministic():
    assert compose_design(_intent()).svg == compose_design(_intent()).svg


def test_avoid_wraps_across_the_tile_seam():
    intent = _intent()
    intent["layers"][1]["placement"]["point_set"]["points"] = [[47.5, 0.5]]
    plain = _intent(avoid=None)
    plain["layers"][1]["placement"]["point_set"]["points"] = [[47.5, 0.5]]
    # (0,0) 점과 토러스 거리 ~0.7mm — 경계 너머에서도 빠진다(원본 + 경계 클론 3개)
    assert _uses(compose_design(intent).svg, "circle") == (
        _uses(compose_design(plain).svg, "circle") - 4
    )


def test_avoid_removing_every_instance_warns():
    intent = _intent()
    intent["layers"][1]["params"]["size_mm"] = 47.0
    design = compose_design(intent)
    assert _uses(design.svg, "circle") == 0
    assert any("removed every instance" in w for w in design.warnings)


@pytest.mark.parametrize(
    ("avoid", "z_order", "message"),
    [
        ("dots", 2, "cannot reference itself"),
        ("nope", 2, "does not exist"),
        ("ground", 2, "must be a motif layer"),
        ("logo", 0, "must be drawn earlier"),
    ],
)
def test_invalid_avoid_reference_is_rejected(avoid, z_order, message):
    intent = _intent(avoid=avoid)
    intent["layers"][2]["z_order"] = z_order
    with pytest.raises(IntentInvalid, match=message):
        compose_design(intent)


def test_placement_patch_keeps_avoid_layer():
    patch = DesignPatchV1.model_validate(
        {"note": "테스트", "placement": {"slot": 2, "arrangement": "staggered"}}
    )
    patched = apply_patch(copy.deepcopy(_intent()), patch)
    dots = next(layer for layer in patched["layers"] if layer["id"] == "dots")
    assert dots["placement"]["avoid_layer"] == "logo"


def _plan(*, avoid: int | None) -> DesignPlanV3:
    dots: dict = {
        "type": "motif",
        "motif_index": 1,
        "size_ratio": 0.05,
        "placement": {"type": "point_template", "template": "grid4_inset"},
    }
    if avoid is not None:
        dots["avoid_motif_layer"] = avoid
    return DesignPlanV3.model_validate(
        {
            "colors": ["#FFFFFF", "#000000"],
            "ground_color_index": 0,
            "motifs": [
                {"source": "input", "input_index": 1},
                {"source": "input", "input_index": 2},
            ],
            "layers": [
                {
                    "type": "motif",
                    "motif_index": 0,
                    "size_ratio": 0.1,
                    "placement": {"type": "point_template", "template": "diagonal_pair"},
                },
                dots,
            ],
        }
    )


def test_absent_avoid_keeps_plan_dump_and_fingerprint():
    plan = _plan(avoid=None)
    assert "avoid_motif_layer" not in str(plan.model_dump(mode="json"))
    compiled = compile_design_plan_v3(plan, motif_ids=["bee", "circle"])
    assert all(
        "avoid_layer" not in layer.get("placement", {}) for layer in compiled.intent["layers"]
    )
    assert structural_fingerprint(plan) != structural_fingerprint(_plan(avoid=0))


def test_plan_ordinal_compiles_to_motif_layer_id():
    compiled = compile_design_plan_v3(_plan(avoid=0), motif_ids=["bee", "circle"])
    motifs = [layer for layer in compiled.intent["layers"] if layer["type"] == "motif"]
    assert motifs[1]["placement"]["avoid_layer"] == "motif_0"
    compose_design(compiled.intent)


def test_plan_rejects_avoid_of_a_later_or_same_layer():
    with pytest.raises(ValueError, match="earlier motif layer"):
        _plan(avoid=1)


def test_snapshot_clears_avoid_when_its_target_is_dropped():
    plan = _plan(avoid=0)
    compiled = compile_design_plan_v3(plan, motif_ids=["bee", "circle"])
    # 리졸버가 motif_0을 soft-drop했다 — motif_1이 서수 0으로 당겨져도 자기 자신을 가리키면 안 된다
    resolved = copy.deepcopy(compiled.intent)
    resolved["layers"] = [layer for layer in resolved["layers"] if layer["id"] != "motif_0"]

    snapshot = snapshot_resolved_plan(plan, resolved)

    assert len(snapshot.layers) == 1
    assert snapshot.layers[0].type == "motif"
    assert snapshot.layers[0].avoid_motif_layer is None


def test_snapshot_keeps_avoid_when_both_layers_survive():
    plan = _plan(avoid=0)
    compiled = compile_design_plan_v3(plan, motif_ids=["bee", "circle"])
    snapshot = snapshot_resolved_plan(plan, compiled.intent)
    assert snapshot.layers[1].type == "motif"
    assert snapshot.layers[1].avoid_motif_layer == 0
