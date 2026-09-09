"""산개 회귀 — 개수 미달 경고와 레이어별 난수열 분리 (design-engine-accuracy 2단계).

함수 단위가 아니라 patch → 제약 → compose까지의 실제 디자인 경로로 재현한다.
"""

import copy

from worker.engine.compose import compose_design
from worker.engine.constraints import apply_generation_constraints
from worker.engine.intent import Placement, ScatterSpec
from worker.engine.patch import DesignPatchV1, apply_patch, set_motif_slot
from worker.engine.placement import _torus_dist, place_scatter

from .intent_helpers import register_test_motifs

register_test_motifs()


def _scatter_intent(*, count: int, min_dist_mm: float, seed_salt: str | None = None) -> dict:
    scatter: dict = {"mode": "poisson", "min_dist_mm": min_dist_mm, "count": count}
    if seed_salt is not None:
        scatter["seed_salt"] = seed_salt
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
                "id": "motif_0",
                "type": "motif",
                "z_order": 1,
                "params": {"motif_id": "circle", "size_mm": 6.0},
                "placement": {"type": "scatter", "scatter": scatter},
            },
        ],
    }


def _centers(intent: dict, layer_index: int, seed: int | None = None) -> list[tuple[float, float]]:
    layer = intent["layers"][layer_index]
    placement = Placement.model_validate(layer["placement"])
    tile = intent["canvas"]["tile_mm"]
    effective = intent["seed"] if seed is None else seed
    return sorted(
        (point.x_mm, point.y_mm) for point in place_scatter(placement, tile, effective)
    )


def _lattice_intent() -> dict:
    intent = _scatter_intent(count=8, min_dist_mm=12.0)
    intent["layers"][1]["placement"] = {
        "type": "lattice",
        "lattice": {"cell_w_mm": 8.0, "cell_h_mm": 8.0},
    }
    return intent


def test_dart_throwing_falls_short_of_the_requested_count():
    """tile 48·min_dist 8에서 30개 요청은 22~23개만 놓인다 — 최소 간격은 지켜진다."""
    placement = Placement(
        type="scatter", scatter=ScatterSpec(mode="poisson", min_dist_mm=8.0, count=30)
    )
    for seed in range(6):
        points = [(p.x_mm, p.y_mm) for p in place_scatter(placement, 48.0, seed)]
        assert len(points) < 30
        assert len(points) >= 22
        closest = min(
            _torus_dist(*a, *b, 48.0)
            for index, a in enumerate(points)
            for b in points[index + 1 :]
        )
        assert closest >= 8.0


def test_scatter_shortfall_surfaces_as_a_warning_not_a_silent_reduction():
    design = compose_design(_scatter_intent(count=30, min_dist_mm=8.0))

    assert any("scatter placed 22 of 30" in warning for warning in design.warnings)
    # 고객 문구는 없다 — 진단·admin 경고 경로에만 남는다(warnings.py 기준).
    from worker.warnings import customer_warnings

    assert customer_warnings(design.warnings) == []


def test_satisfiable_scatter_count_warns_nothing():
    assert compose_design(_scatter_intent(count=8, min_dist_mm=12.0)).warnings == []


def test_global_scatter_patch_does_not_stack_the_two_slots():
    """전역 산개 patch는 두 슬롯에 같은 설정을 준다 — 좌표까지 같으면 안 된다."""
    base = set_motif_slot(_lattice_intent(), slot=2, motif_id="bee")
    patch = DesignPatchV1.model_validate(
        {"note": "흩뿌려줘", "placement": {"arrangement": "scatter", "count_per_axis": 4}}
    )

    patched = apply_generation_constraints(apply_patch(base, patch))

    first, second = (layer["placement"]["scatter"] for layer in patched["layers"][1:3])
    assert first["min_dist_mm"] == second["min_dist_mm"]  # 같은 밀도 요청
    assert (first["seed_salt"], second["seed_salt"]) == ("motif_0", "motif_slot_2")
    assert _centers(patched, 1) != _centers(patched, 2)
    compose_design(patched)


def test_seed_salt_stream_follows_the_layer_not_the_motif():
    """모티프 교체로 좌표가 바뀌면 안 된다 — salt에 motif_id를 넣지 않았다는 회귀."""
    intent = _scatter_intent(count=8, min_dist_mm=12.0, seed_salt="motif_0")
    swapped = copy.deepcopy(intent)
    swapped["layers"][1]["params"]["motif_id"] = "bee"

    assert _centers(swapped, 1) == _centers(intent, 1)


def test_seed_override_still_moves_a_salted_layer():
    intent = _scatter_intent(count=8, min_dist_mm=12.0, seed_salt="motif_0")

    assert _centers(intent, 1, seed=1) != _centers(intent, 1, seed=2)


def test_intent_without_seed_salt_keeps_the_legacy_stream():
    """salt 없는 기존 intent는 전역 seed 그대로 — 저장된 디자인이 재현된다."""
    legacy = _scatter_intent(count=8, min_dist_mm=12.0)
    salted = _scatter_intent(count=8, min_dist_mm=12.0, seed_salt="motif_0")

    assert _centers(legacy, 1) == _centers(_scatter_intent(count=8, min_dist_mm=12.0), 1)
    assert _centers(legacy, 1) != _centers(salted, 1)
    again = _scatter_intent(count=8, min_dist_mm=12.0)
    assert compose_design(legacy).svg == compose_design(again).svg
