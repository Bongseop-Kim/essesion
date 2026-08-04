"""Plan v3 contract, compiler golden, and starter-manifest tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from worker.authoring.compiler import PlanCompileError, compile_design_plan_v3
from worker.authoring.examples import _validate_example_set, load_example_set
from worker.authoring.schema import (
    DesignPlanV3,
    LatticePlacementPlan,
    snapshot_resolved_plan,
    structural_fingerprint,
)
from worker.config import get_settings
from worker.engine.intent import ScatterSpec
from worker.engine.placement import scatter_target_count
from worker.engine.validate import validate_intent

GOLDEN_DIR = Path(__file__).parent / "golden/json"


def _golden(example) -> dict:  # noqa: ANN001
    filename = f"{example.example_id.removeprefix('gallery_')}.json"
    return json.loads((GOLDEN_DIR / filename).read_text(encoding="utf-8"))


def _geometry(intent: dict) -> object:
    """Layer geometry of an engine intent, free of naming and encoding differences.

    Bands keep only their gaps: plan offsets must sit inside [0, period), so two goldens
    (17, 18) are only expressible as a translated band set. Palette slot names and an explicit
    zero rotation carry no geometry. Layer id spelling doesn't either, so a host reference is
    compared as the ordinal of the stripe layer it points at; a scatter count is compared as the
    instance total the engine lands on, since goldens may omit it and let the engine derive it.
    """

    cap = get_settings().max_placement_instances
    tile_mm = intent["canvas"]["tile_mm"]
    stripe_ids = [layer["id"] for layer in intent["layers"] if layer["type"] == "stripe"]
    shapes: list[dict] = []
    for layer in intent["layers"]:
        params = layer["params"]
        if layer["type"] == "stripe":
            offsets = [band["offset_mm"] for band in params["bands"]]
            shapes.append(
                {
                    "angle": params["angle"],
                    "period_mm": params["period_mm"],
                    "widths": [band["width_mm"] for band in params["bands"]],
                    "gaps": [b - a for a, b in zip(offsets, offsets[1:], strict=False)],
                }
            )
        elif layer["type"] == "motif":
            placement = json.loads(json.dumps(layer["placement"]))
            if placement.get("fixed_rotation_deg") == 0:
                del placement["fixed_rotation_deg"]
            if (scatter := placement.get("scatter")) is not None:
                scatter["count"] = scatter_target_count(
                    ScatterSpec.model_validate(scatter), tile_mm, cap
                )
            if "host_layer" in placement:
                placement["host_layer"] = stripe_ids.index(placement["host_layer"])
            shapes.append({"size_mm": params["size_mm"], "placement": placement})
    return json.loads(json.dumps(shapes), parse_float=lambda raw: round(float(raw), 3))


def _motif_ids(intent: dict) -> list[str]:
    result: list[str] = []
    for layer in intent["layers"]:
        if layer["type"] != "motif":
            continue
        motif_id = layer["params"]["motif_id"]
        if motif_id not in result:
            result.append(motif_id)
    return result


def _input_plan() -> DesignPlanV3:
    return DesignPlanV3.model_validate(
        {
            "colors": ["#10243A", "#EF8A7A"],
            "ground_color_index": 0,
            "motifs": [{"source": "input", "input_index": 1}],
            "layers": [
                {
                    "type": "motif",
                    "motif_index": 0,
                    "size_ratio": 0.15,
                    "placement": {"type": "lattice", "columns": 4, "rows": 4},
                }
            ],
        }
    )


def test_gallery_v1_is_reviewable_and_golden_filenames_follow_the_id_convention():
    examples = load_example_set()

    assert examples
    assert {example.family for example in examples} == {
        "solid",
        "stripe",
        "lattice",
        "scatter",
        "path",
        "point_set",
        "stripe_motif",
        "multi_motif",
    }
    for example in examples:
        golden_path = GOLDEN_DIR / f"{example.example_id.removeprefix('gallery_')}.json"
        assert golden_path.is_file()
        assert example.prompt_example()["plan"] == example.plan.model_dump(mode="json")


def test_starter_loader_accepts_a_smaller_curated_set():
    raw = [example.model_dump(mode="json") for example in load_example_set()[:2]]

    assert [example.example_id for example in _validate_example_set(raw)] == [
        item["example_id"] for item in raw
    ]


def test_all_gallery_plans_compile_deterministically_to_valid_engine_intents():
    compiled_placements: set[str] = set()
    for example in load_example_set():
        golden = _golden(example)
        motif_ids = _motif_ids(golden)
        kwargs = {
            "motif_ids": motif_ids,
            "seed": golden["seed"],
            "tile_mm": golden["canvas"]["tile_mm"],
            "dpi": golden["canvas"]["dpi"],
        }
        first = compile_design_plan_v3(example.plan, **kwargs)
        second = compile_design_plan_v3(example.plan, **kwargs)

        assert first == second
        assert first.plan == example.plan.model_dump(mode="json")
        assert first.structural_fingerprint == structural_fingerprint(example.plan)
        assert _motif_ids(first.intent) == motif_ids
        # 예시는 골든 25건의 정답지다 — 지오메트리가 벌어지면 프롬프트가 요구하는 구조와
        # RAG가 보여주는 구조가 달라져 역설계 재현이 원리적으로 불가능해진다.
        assert _geometry(first.intent) == _geometry(golden), example.example_id
        validate_intent(first.intent, repair=False)
        compiled_placements.update(
            layer["placement"]["type"]
            for layer in first.intent["layers"]
            if layer["type"] == "motif"
        )

    assert compiled_placements == {"lattice", "scatter", "path_following", "point_set"}


def test_lattice_half_drop_rounds_odd_drop_axis_count_up_to_close_the_torus():
    # A3 회귀: 모델이 half drop을 유지한 채 홀수 열을 뽑으면 엔진 torus closure에서
    # 거부되던 것을 스키마가 짝수로 올림 보정한다. drop축이 아닌 축은 건드리지 않는다.
    column_drop = LatticePlacementPlan(type="lattice", columns=5, rows=3, drop="half_column")
    assert (column_drop.columns, column_drop.rows) == (6, 3)
    row_drop = LatticePlacementPlan(type="lattice", columns=5, rows=3, drop="half_row")
    assert (row_drop.columns, row_drop.rows) == (5, 4)
    no_drop = LatticePlacementPlan(type="lattice", columns=5, rows=3)
    assert (no_drop.columns, no_drop.rows) == (5, 3)
    ceiling = LatticePlacementPlan(type="lattice", columns=15, rows=2, drop="half_column")
    assert ceiling.columns == 16

    plan = _input_plan()
    raw = plan.model_dump(mode="json")
    raw["layers"][0]["placement"] = {
        "type": "lattice",
        "columns": 5,
        "rows": 3,
        "drop": "half_column",
    }
    design = compile_design_plan_v3(DesignPlanV3.model_validate(raw), motif_ids=["pelican"])
    validate_intent(design.intent, repair=False)


def test_schema_rejects_invalid_indexes_blank_references_and_host_mismatch():
    base = load_example_set()[14].plan.model_dump(mode="json")

    bad_color = json.loads(json.dumps(base))
    bad_color["layers"][0]["bands"][0]["color_index"] = 99
    with pytest.raises(ValidationError, match="color_index"):
        DesignPlanV3.model_validate(bad_color)

    bad_band = json.loads(json.dumps(base))
    bad_band["layers"][0]["bands"][0]["offset_ratio"] = 0.95
    with pytest.raises(ValidationError, match="within one period"):
        DesignPlanV3.model_validate(bad_band)

    hosted = next(
        example.plan.model_dump(mode="json")
        for example in load_example_set()
        if any(
            layer.type == "motif"
            and getattr(layer.placement, "host_stripe_index", None) is not None
            for layer in example.plan.layers
        )
    )
    bad_host = json.loads(json.dumps(hosted))
    hosted_layer = next(
        layer
        for layer in bad_host["layers"]
        if layer["type"] == "motif" and layer["placement"].get("host_stripe_index") is not None
    )
    hosted_layer["placement"]["direction"] = "horizontal"
    with pytest.raises(ValidationError, match="hosted path direction"):
        DesignPlanV3.model_validate(bad_host)

    removed_source = {
        "colors": ["#000000", "#ffffff"],
        "ground_color_index": 0,
        "motifs": [
            {
                "source": "reference",
                "reference_image_index": 1,
                "subject": "flower",
            }
        ],
        "layers": [
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.1,
                "placement": {
                    "type": "lattice",
                    "columns": 2,
                    "rows": 2,
                },
            }
        ],
    }
    with pytest.raises(ValidationError, match="Input tag"):
        DesignPlanV3.model_validate(removed_source)

    duplicate_colors = json.loads(json.dumps(base))
    duplicate_colors["colors"][1] = duplicate_colors["colors"][0].lower()
    with pytest.raises(ValidationError, match="duplicate normalized color"):
        DesignPlanV3.model_validate(duplicate_colors)


def test_schema_and_compiler_support_two_alternating_motif_lanes():
    source = next(
        example.plan
        for example in load_example_set()
        if example.example_id == "gallery_22_motif_path_alternating_bee_circle"
    )
    raw = source.model_dump(mode="json")
    first, second = [layer for layer in raw["layers"] if layer["type"] == "motif"][:2]
    for layer, phase_ratio in ((first, 0.0), (second, 0.1)):
        layer["placement"]["spacing_ratio"] = 0.2
        layer["placement"]["phase_ratio"] = phase_ratio

    stripe = {
        "type": "stripe",
        "direction": "diagonal_up",
        "period_ratio": 0.70710677,
        "bands": [
            {"color_index": 0, "width_ratio": 0.001, "offset_ratio": 0.0},
            {"color_index": 0, "width_ratio": 0.001, "offset_ratio": 0.5},
        ],
    }
    motif_layers = []
    for band_index in range(2):
        for source_layer in (first, second):
            layer = json.loads(json.dumps(source_layer))
            layer["placement"]["host_stripe_index"] = 0
            layer["placement"]["host_band_index"] = band_index
            motif_layers.append(layer)
    raw["layers"] = [stripe, *motif_layers]

    plan = DesignPlanV3.model_validate(raw)
    compiled = compile_design_plan_v3(
        plan,
        motif_ids=["bee", "circle"],
    )
    compiled_motifs = [layer for layer in compiled.intent["layers"] if layer["type"] == "motif"]

    assert [layer["placement"]["host_layer"] for layer in compiled_motifs] == ["stripe_0"] * 4
    assert [layer["placement"]["lane"] for layer in compiled_motifs] == [
        "b0.center",
        "b0.center",
        "b1.center",
        "b1.center",
    ]
    assert [layer["params"]["motif_id"] for layer in compiled_motifs] == [
        "bee",
        "circle",
        "bee",
        "circle",
    ]

    too_many = plan.model_dump(mode="json")
    too_many["layers"].append(json.loads(json.dumps(too_many["layers"][-1])))
    with pytest.raises(ValidationError, match="at most 5"):
        DesignPlanV3.model_validate(too_many)


@pytest.mark.parametrize("source", ["generate", "reference"])
def test_schema_rejects_removed_motif_sources(source: str):
    raw = _input_plan().model_dump(mode="json")
    removed_motif: dict[str, object] = {"source": source, "subject": "pelican"}
    if source == "reference":
        removed_motif["reference_image_index"] = 1
    raw["motifs"] = [removed_motif]

    with pytest.raises(ValidationError, match="Input tag"):
        DesignPlanV3.model_validate(raw)


def test_compiler_accepts_motif_free_plan_with_catalog_candidates():
    plan = load_example_set()[0].plan

    compiled = compile_design_plan_v3(
        plan,
        catalog_candidates=[{"catalog_ref": "candidate_1", "motif_id": "catalog-id"}],
    )

    assert compiled.plan is not None
    assert compiled.plan["motifs"] == []


def test_compiler_requires_each_exact_input_once():
    raw = load_example_set()[20].plan.model_dump(mode="json")
    raw["motifs"] = [
        {"source": "input", "input_index": 1},
        {"source": "input", "input_index": 1},
    ]
    plan = DesignPlanV3.model_validate(raw)

    with pytest.raises(PlanCompileError, match="exactly once"):
        compile_design_plan_v3(plan, motif_ids=["first", "second"])

    with pytest.raises(PlanCompileError, match="must be distinct"):
        compile_design_plan_v3(plan, motif_ids=["same", "same"])


def test_compiler_rejects_duplicate_grounded_sources():
    raw = load_example_set()[20].plan.model_dump(mode="json")
    raw["motifs"] = [
        {"source": "catalog", "catalog_ref": "candidate_1"},
        {"source": "catalog", "catalog_ref": "candidate_1"},
    ]
    catalog_plan = DesignPlanV3.model_validate(raw)
    with pytest.raises(PlanCompileError, match="at most once"):
        compile_design_plan_v3(
            catalog_plan,
            catalog_candidates=[{"catalog_ref": "candidate_1", "motif_id": "catalog-id"}],
        )


def test_compiler_emits_no_motif_color_binding():
    compiled = compile_design_plan_v3(_input_plan(), motif_ids=["pelican"])
    motif = next(layer for layer in compiled.intent["layers"] if layer["type"] == "motif")

    assert motif["params"] == {"motif_id": "pelican", "size_mm": 7.2}


def test_compiler_unknown_catalog_ref_feedback_names_the_corrective_action():
    raw = load_example_set()[20].plan.model_dump(mode="json")
    raw["motifs"] = [
        {"source": "catalog", "catalog_ref": "hallucinated-ref-1"},
        {"source": "catalog", "catalog_ref": "hallucinated-ref-2"},
    ]
    plan = DesignPlanV3.model_validate(raw)

    # 후보가 하나도 없으면 날조된 ref를 되풀이하지 않도록 motifs=[]를 직접 지시한다.
    with pytest.raises(PlanCompileError, match="set(?s:.*)motifs to \\[\\]"):
        compile_design_plan_v3(plan, catalog_candidates=[])

    with pytest.raises(PlanCompileError, match="tokens from the data block"):
        compile_design_plan_v3(
            plan,
            catalog_candidates=[{"catalog_ref": "candidate_1", "motif_id": "catalog-id"}],
        )


def test_structural_fingerprint_ignores_palette_but_not_geometry():
    source = load_example_set()[5].plan.model_dump(mode="json")
    recolored = json.loads(json.dumps(source))
    recolored["colors"] = [
        "#111111",
        "#222222",
        "#333333",
        "#444444",
        "#555555",
        "#666666",
        "#777777",
        "#888888",
    ]
    reshaped = json.loads(json.dumps(source))
    reshaped["layers"][0]["placement"]["columns"] += 1

    original = DesignPlanV3.model_validate(source)
    assert structural_fingerprint(original) == structural_fingerprint(
        DesignPlanV3.model_validate(recolored)
    )
    assert structural_fingerprint(original) != structural_fingerprint(
        DesignPlanV3.model_validate(reshaped)
    )


def test_structural_fingerprint_includes_motif_identity():
    source = load_example_set()[5].plan.model_dump(mode="json")
    source["motifs"] = [{"source": "catalog", "catalog_ref": "motif-a"}]
    changed = json.loads(json.dumps(source))
    changed["motifs"] = [{"source": "catalog", "catalog_ref": "motif-b"}]

    first = DesignPlanV3.model_validate(source)
    second = DesignPlanV3.model_validate(changed)
    assert structural_fingerprint(first) != structural_fingerprint(second)


def test_snapshot_resolved_plan_freezes_concrete_motif_identity():
    plan = load_example_set()[5].plan
    compiled = compile_design_plan_v3(
        plan,
        motif_ids=["circle"],
    )

    snapshot = snapshot_resolved_plan(plan, compiled.intent)

    assert snapshot.motifs[0].source == "catalog"
    assert snapshot.motifs[0].catalog_ref == "circle"
    assert snapshot.layers == plan.layers
    recompiled = compile_design_plan_v3(
        snapshot,
        catalog_candidates=[
            {
                "catalog_ref": "circle",
                "motif_id": "circle",
                "current": True,
            }
        ],
    )
    assert _motif_ids(recompiled.intent) == ["circle"]


def test_compiler_never_emits_semantic_motif_placeholders():
    plan = load_example_set()[14].plan

    compiled = compile_design_plan_v3(plan, motif_ids=["circle"])

    assert _motif_ids(compiled.intent) == ["circle"]
    assert "semantic_" not in json.dumps(compiled.intent)
