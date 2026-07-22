"""Plan v3 contract, compiler, and immutable gallery example tests."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from worker.authoring.compiler import PlanCompileError, compile_design_plan_v3
from worker.authoring.examples import load_example_set
from worker.authoring.rollout import (
    AuthoringRuntimeSettings,
    load_authoring_runtime_settings,
    select_authoring_cohort,
)
from worker.authoring.schema import DesignPlanV3, structural_fingerprint
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


def test_rollout_is_database_controlled_and_request_stable():
    request_id = "request-stable-123"
    legacy = AuthoringRuntimeSettings(
        authoring_pipeline_mode="legacy",
        authoring_canary_percent=100,
        authoring_shadow_percent=100,
    )
    canary = AuthoringRuntimeSettings(
        authoring_pipeline_mode="canary",
        authoring_canary_percent=100,
        authoring_shadow_percent=0,
    )
    shadow = AuthoringRuntimeSettings(
        authoring_pipeline_mode="shadow",
        authoring_canary_percent=0,
        authoring_shadow_percent=100,
    )

    assert select_authoring_cohort(legacy, request_id).pipeline == "legacy"
    assert select_authoring_cohort(canary, request_id).pipeline == "v3"
    assert select_authoring_cohort(shadow, request_id).shadow_v3 is True
    assert select_authoring_cohort(shadow, request_id) == select_authoring_cohort(
        shadow, request_id
    )


async def test_rollout_settings_fail_closed_to_legacy():
    class _Session:
        def __init__(self, rows):
            self.rows = rows

        async def execute(self, _query):
            return self.rows

    missing = await load_authoring_runtime_settings(cast(AsyncSession, _Session([])))
    invalid = await load_authoring_runtime_settings(
        cast(
            AsyncSession,
            _Session(
                [
                    ("authoring_pipeline_mode", "canary"),
                    ("authoring_shadow_percent", "5"),
                    ("authoring_canary_percent", "101"),
                ]
            ),
        )
    )
    ready = await load_authoring_runtime_settings(
        cast(
            AsyncSession,
            _Session(
                [
                    ("authoring_pipeline_mode", "canary"),
                    ("authoring_shadow_percent", "5"),
                    ("authoring_canary_percent", "10"),
                ]
            ),
        )
    )

    assert (missing.authoring_pipeline_mode, missing.status) == ("legacy", "missing")
    assert (invalid.authoring_pipeline_mode, invalid.status) == ("legacy", "invalid")
    assert (ready.authoring_pipeline_mode, ready.authoring_canary_percent) == ("canary", 10)
