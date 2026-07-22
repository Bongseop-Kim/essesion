import json
from pathlib import Path


def test_authoring_eval_corpus_has_30_distinct_prompts():
    corpus_path = Path(__file__).parents[1] / "scripts/authoring_prompts.json"
    cases = json.loads(corpus_path.read_text(encoding="utf-8"))

    assert len(cases) == 30
    assert len({case["id"] for case in cases}) == 30
    assert len({case["prompt"] for case in cases}) == 30
    assert all(10 <= len(case["prompt"]) <= 100 for case in cases)
    assert all(case["motif_count"] in {0, 1, 2} for case in cases)
    assert all(case["expected_families"] for case in cases)
