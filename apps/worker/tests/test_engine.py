"""결정론 계약 대조 — 원본 엔진 골든과 byte-identical (worker-pipeline.md §6)."""

import json
import os
import subprocess
import sys

import pytest
from worker.engine import generate, generate_candidates

from .golden_helpers import GOLDEN, golden_intents, golden_svg, register_golden_motifs

register_golden_motifs()


@pytest.mark.parametrize(
    "stem,intent", golden_intents(), ids=lambda v: v if isinstance(v, str) else ""
)
def test_gallery_goldens_byte_identical(stem, intent):
    assert generate(intent).svg == golden_svg(stem)


def test_seed_variants_byte_identical():
    intent = json.loads((GOLDEN / "json" / "09_motif_scatter_poisson.json").read_text())
    for seed in (1, 12345):
        assert generate(intent, seed=seed).svg == golden_svg(
            f"09_motif_scatter_poisson__seed{seed}"
        )


def test_seed_changes_scatter_bytes():
    intent = json.loads((GOLDEN / "json" / "09_motif_scatter_poisson.json").read_text())
    assert generate(intent, seed=1).svg != generate(intent, seed=2).svg


def test_compose_is_hashseed_independent():
    script = """
import json, sys
from pathlib import Path
sys.path.insert(0, "apps/worker/tests")
from golden_helpers import register_golden_motifs
from worker.engine import generate
register_golden_motifs()
path = Path("apps/worker/tests/golden/json/24_motif_wave_duet_bee_circle.json")
intent = json.loads(path.read_text())
print(generate(intent).svg)
"""
    outputs = []
    for seed in ("0", "1", "12345"):
        result = subprocess.run(
            [sys.executable, "-c", script],
            env={**os.environ, "PYTHONHASHSEED": seed},
            text=True,
            stdout=subprocess.PIPE,
            check=True,
        )
        outputs.append(result.stdout)
    assert outputs[0] == outputs[1] == outputs[2]


def test_candidates_match_original_engine():
    """generate_candidates(count=4)의 id·svg가 원본 엔진 산출 세트와 일치."""
    intent = json.loads((GOLDEN / "json" / "09_motif_scatter_poisson.json").read_text())
    expected = json.loads((GOLDEN / "candidates.json").read_text())

    candidate_set = generate_candidates(intent, candidate_count=4)
    assert [rc.id for rc in candidate_set.candidates] == [c["id"] for c in expected["candidates"]]
    assert list(candidate_set.warnings) == list(expected["warnings"])
    for ranked, meta in zip(candidate_set.candidates, expected["candidates"], strict=True):
        assert ranked.candidate.layout_id == meta["layout_id"]
        assert ranked.colorway_id == meta["colorway_id"]
        assert ranked.seed == meta["seed"]
        assert ranked.candidate.svg == (GOLDEN / "candidates" / meta["svg_file"]).read_text()


def test_candidates_are_deterministic():
    intent = json.loads((GOLDEN / "json" / "09_motif_scatter_poisson.json").read_text())
    first = generate_candidates(intent, candidate_count=8)
    second = generate_candidates(intent, candidate_count=8)
    assert [rc.id for rc in first.candidates] == [rc.id for rc in second.candidates]
    assert len(first.candidates) <= 8


def test_unknown_motif_rejected():
    intent = json.loads((GOLDEN / "json" / "21_motif_lattice_bee_circle.json").read_text())
    intent["layers"][1]["params"]["motif_id"] = "recraft-000000000000"
    with pytest.raises(ValueError, match="unknown motif"):
        generate(intent)
