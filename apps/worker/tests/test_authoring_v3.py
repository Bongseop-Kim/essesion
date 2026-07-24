"""Plan v3 contract, compiler, and immutable gallery example tests."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from worker.authoring.compiler import PlanCompileError, compile_design_plan_v3
from worker.authoring.examples import load_example_set
from worker.authoring.schema import (
    DesignPlanV3,
    GenerateMotifSource,
    MotifLayerPlan,
    motif_source_signature,
    snapshot_resolved_plan,
    structural_fingerprint,
)
from worker.engine.constraints import PaletteConstraint
from worker.engine.validate import validate_intent

GOLDEN_DIR = Path(__file__).parent / "golden/json"


def _golden(example) -> dict:  # noqa: ANN001
    return json.loads((GOLDEN_DIR / example.golden_file).read_text(encoding="utf-8"))


def _motif_ids(intent: dict) -> list[str]:
    result: list[str] = []
    for layer in intent["layers"]:
        if layer["type"] != "motif":
            continue
        motif_id = layer["params"]["motif_id"]
        if motif_id not in result:
            result.append(motif_id)
    return result


def _generate_plan(*, color_indices: list[int] | None = None) -> DesignPlanV3:
    layer = {
        "type": "motif",
        "motif_index": 0,
        "size_ratio": 0.15,
        "placement": {"type": "lattice", "columns": 4, "rows": 4},
    }
    if color_indices is not None:
        layer["color_indices"] = color_indices
    return DesignPlanV3.model_validate(
        {
            "colors": ["#10243A", "#EF8A7A"],
            "ground_color_index": 0,
            "motifs": [{"source": "generate", "subject": " 펠리컨 "}],
            "layers": [layer],
        }
    )


def test_gallery_v1_is_complete_reviewable_and_bound_to_goldens():
    examples = load_example_set()

    assert len(examples) == 25
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
        golden_path = GOLDEN_DIR / example.golden_file
        assert hashlib.sha256(golden_path.read_bytes()).hexdigest() == example.golden_sha256
        assert example.prompt_example()["plan"] == example.plan.model_dump(mode="json")


def test_all_gallery_plans_compile_deterministically_to_valid_engine_intents():
    compiled_placements: set[str] = set()
    for example in load_example_set():
        golden = _golden(example)
        motif_ids = _motif_ids(golden)
        kwargs = {
            "plan_index": 0,
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
        validate_intent(first.intent, repair=False, motifs={})
        compiled_placements.update(
            layer["placement"]["type"]
            for layer in first.intent["layers"]
            if layer["type"] == "motif"
        )

    assert compiled_placements == {"lattice", "scatter", "path_following", "point_set"}


def test_schema_rejects_invalid_indexes_blank_references_and_host_mismatch():
    base = load_example_set()[14].plan.model_dump(mode="json")

    bad_color = json.loads(json.dumps(base))
    bad_color["layers"][0]["bands"][0]["color_index"] = 99
    with pytest.raises(ValidationError, match="color_index"):
        DesignPlanV3.model_validate(bad_color)

    bad_host = json.loads(json.dumps(base))
    bad_host["layers"][1]["placement"]["direction"] = "horizontal"
    with pytest.raises(ValidationError, match="hosted path direction"):
        DesignPlanV3.model_validate(bad_host)

    blank_reference = {
        "colors": ["#000000", "#ffffff"],
        "ground_color_index": 0,
        "motifs": [
            {
                "source": "reference",
                "reference_image_index": 1,
                "subject": "   ",
            }
        ],
        "layers": [
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.1,
                "color_indices": [1],
                "placement": {
                    "type": "lattice",
                    "columns": 2,
                    "rows": 2,
                },
            }
        ],
    }
    with pytest.raises(ValidationError, match="may not be blank"):
        DesignPlanV3.model_validate(blank_reference)

    duplicate_colors = json.loads(json.dumps(base))
    duplicate_colors["colors"][1] = duplicate_colors["colors"][0].lower()
    with pytest.raises(ValidationError, match="duplicate normalized color"):
        DesignPlanV3.model_validate(duplicate_colors)


def test_generate_motif_source_is_discriminated_bounded_and_stripped():
    plan = _generate_plan()

    assert isinstance(plan.motifs[0], GenerateMotifSource)
    assert plan.motifs[0].subject == "펠리컨"
    assert plan.motifs[0].scope == "whole"
    assert isinstance(plan.layers[0], MotifLayerPlan)
    assert plan.layers[0].color_indices is None

    too_long = plan.model_dump(mode="json")
    too_long["motifs"][0]["subject"] = "x" * 81
    with pytest.raises(ValidationError, match="80 characters"):
        DesignPlanV3.model_validate(too_long)
    too_long["motifs"][0]["subject"] = "pelican"
    too_long["motifs"][0]["description"] = "x" * 161
    with pytest.raises(ValidationError, match="160 characters"):
        DesignPlanV3.model_validate(too_long)


def test_generate_source_compiles_best_effort_only_without_catalog_grounding():
    compiled = compile_design_plan_v3(_generate_plan(), plan_index=0)

    assert compiled.motif_specs == [
        {
            "layer_id": "motif_0",
            "subject": "펠리컨",
            "scope": "whole",
            "style": None,
            "description": None,
            "required": False,
        }
    ]
    assert compiled.motif_color_slots == {}

    with pytest.raises(PlanCompileError, match="verified catalog is empty") as caught:
        compile_design_plan_v3(
            _generate_plan(),
            plan_index=0,
            catalog_candidates=[
                {"catalog_ref": "catalog_1", "motif_id": "recraft-grounded"}
            ],
        )
    assert caught.value.grounding is True


def test_fixed_palette_requires_explicit_motif_color_indices():
    fixed = PaletteConstraint(mode="fixed", colors=["#10243A", "#EF8A7A"])

    with pytest.raises(PlanCompileError, match="must declare color_indices"):
        compile_design_plan_v3(
            _generate_plan(),
            plan_index=0,
            palette_constraint=fixed,
        )

    compiled = compile_design_plan_v3(
        _generate_plan(color_indices=[1]),
        plan_index=0,
        palette_constraint=fixed,
    )
    assert compiled.motif_color_slots == {"motif_0": ["color_1"]}


def test_compiler_accepts_motif_free_plan_with_catalog_candidates_and_one_reference():
    plan = load_example_set()[0].plan

    compiled = compile_design_plan_v3(
        plan,
        plan_index=0,
        catalog_candidates=[{"catalog_ref": "candidate_1", "motif_id": "catalog-id"}],
        reference_image_count=1,
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
        compile_design_plan_v3(plan, plan_index=0, motif_ids=["first", "second"])

    with pytest.raises(PlanCompileError, match="must be distinct"):
        compile_design_plan_v3(plan, plan_index=0, motif_ids=["same", "same"])


def test_compiler_rejects_duplicate_grounded_sources():
    raw = load_example_set()[20].plan.model_dump(mode="json")
    raw["motifs"] = [
        {
            "source": "reference",
            "reference_image_index": 1,
            "subject": "flower",
        },
        {
            "source": "reference",
            "reference_image_index": 1,
            "subject": "leaf",
        },
    ]
    reference_plan = DesignPlanV3.model_validate(raw)
    with pytest.raises(PlanCompileError, match="exactly once"):
        compile_design_plan_v3(
            reference_plan,
            plan_index=0,
            reference_motif_indexes={1},
            reference_image_count=1,
        )

    raw["motifs"] = [
        {"source": "catalog", "catalog_ref": "candidate_1"},
        {"source": "catalog", "catalog_ref": "candidate_1"},
    ]
    catalog_plan = DesignPlanV3.model_validate(raw)
    with pytest.raises(PlanCompileError, match="at most once"):
        compile_design_plan_v3(
            catalog_plan,
            plan_index=0,
            catalog_candidates=[{"catalog_ref": "candidate_1", "motif_id": "catalog-id"}],
        )


def test_compiler_requires_every_fixed_color_to_be_guaranteed_visible():
    plan = load_example_set()[1].plan
    fixed = PaletteConstraint(mode="fixed", colors=plan.colors[:5])
    raw = plan.model_dump(mode="json")
    raw["colors"] = fixed.colors
    raw["layers"][0]["bands"][0]["color_index"] = 1

    with pytest.raises(PlanCompileError, match="missing color indexes"):
        compile_design_plan_v3(
            DesignPlanV3.model_validate(raw),
            plan_index=0,
            palette_constraint=fixed,
        )

    raw["layers"][0]["bands"] = [
        {"offset_ratio": index * 0.2, "width_ratio": 0.1, "color_index": index + 1}
        for index in range(4)
    ]
    compiled = compile_design_plan_v3(
        DesignPlanV3.model_validate(raw),
        plan_index=0,
        palette_constraint=fixed,
    )
    validate_intent(compiled.intent, repair=False, motifs={})


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
    assert motif_source_signature(first) != motif_source_signature(second)
    assert structural_fingerprint(first) != structural_fingerprint(second)


def test_snapshot_resolved_plan_freezes_concrete_motif_identity():
    plan = load_example_set()[5].plan
    compiled = compile_design_plan_v3(
        plan,
        plan_index=0,
        motif_ids=["circle"],
    )

    snapshot = snapshot_resolved_plan(plan, compiled.intent)

    assert snapshot.motifs[0].source == "catalog"
    assert snapshot.motifs[0].catalog_ref == "circle"
    assert snapshot.layers == plan.layers
    recompiled = compile_design_plan_v3(
        snapshot,
        plan_index=0,
        catalog_candidates=[
            {
                "catalog_ref": "circle",
                "motif_id": "circle",
                "current": True,
            }
        ],
    )
    assert _motif_ids(recompiled.intent) == ["circle"]


def test_snapshot_resolved_plan_prunes_soft_dropped_optional_motif():
    plan = load_example_set()[14].plan
    compiled = compile_design_plan_v3(
        plan,
        plan_index=0,
        motif_ids=["circle"],
    )
    resolved = json.loads(json.dumps(compiled.intent))
    resolved["layers"] = [
        layer for layer in resolved["layers"] if layer["type"] != "motif"
    ]

    snapshot = snapshot_resolved_plan(plan, resolved)

    assert snapshot.motifs == []
    assert [layer.type for layer in snapshot.layers] == ["stripe"]
