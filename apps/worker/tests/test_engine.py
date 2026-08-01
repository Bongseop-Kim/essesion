"""결정론 계약 대조 — 원본 엔진 골든과 byte-identical (worker-pipeline.md §6)."""

import json
import os
import subprocess
import sys

import pytest
from worker.engine import compose_design, generate

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


def test_compose_design_matches_original_engine():
    """compose_design의 id·svg가 원본 엔진 산출(기본 seed·기본 컬러웨이)과 일치."""
    intent = json.loads((GOLDEN / "json" / "09_motif_scatter_poisson.json").read_text())
    # candidates.json / candidates/<svg> 명칭은 원본 엔진 골든과의 호환 기준선 — 의도적으로 유지.
    expected = json.loads((GOLDEN / "candidates.json").read_text())["candidates"][0]

    design = compose_design(intent)
    assert design.id == expected["id"]
    assert design.layout_id == expected["layout_id"]
    assert design.colorway_id == expected["colorway_id"]
    assert design.seed == expected["seed"]
    assert design.warnings == []
    assert design.svg == (GOLDEN / "candidates" / expected["svg_file"]).read_text()


def test_compose_design_is_deterministic():
    intent = json.loads((GOLDEN / "json" / "09_motif_scatter_poisson.json").read_text())
    first = compose_design(intent, seed=7)
    second = compose_design(intent, seed=7)
    assert first.id == second.id
    assert first.svg == second.svg


def test_unknown_motif_rejected():
    intent = json.loads((GOLDEN / "json" / "21_motif_lattice_bee_circle.json").read_text())
    intent["layers"][1]["params"]["motif_id"] = "recraft-000000000000"
    with pytest.raises(ValueError, match="unknown motif"):
        generate(intent)
