import json
from pathlib import Path


def test_authoring_eval_corpus_has_30_distinct_prompts():
    corpus_path = Path(__file__).parents[1] / "scripts/authoring_prompts.json"
    prompts = json.loads(corpus_path.read_text(encoding="utf-8"))

    assert len(prompts) == 30
    assert len(set(prompts)) == 30
    assert all(isinstance(prompt, str) and 10 <= len(prompt) <= 100 for prompt in prompts)
