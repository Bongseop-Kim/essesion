"""The scorer must distinguish valid-but-wrong designs from satisfying candidates."""

import copy
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest
from worker.engine.patch import DesignPatchV1, apply_patch

SCRIPT = Path(__file__).parents[1] / "scripts/eval_design_accuracy.py"
spec = importlib.util.spec_from_file_location("eval_design_accuracy", SCRIPT)
assert spec is not None and spec.loader is not None
scoring = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = scoring
spec.loader.exec_module(scoring)


def corpus():
    return scoring.Corpus.model_validate_json(scoring.DEFAULT_CORPUS.read_text())


def one_case(index, intent=None, rejection=None):
    data = corpus()
    case = data.cases[index - 1]
    data.cases = [case]
    observation = scoring.Observation(case_id=case.id, intent=intent, rejection=rejection)
    return scoring.evaluate(data, [observation])


def candidate(index):
    """Hand-specified satisfying candidates; these are not model benchmark outputs."""
    data = corpus()
    before = data.cases[index - 1].before or "base"
    raw = copy.deepcopy(data.fixtures[before])
    if index <= 8:
        if index == 1:
            raw = copy.deepcopy(data.fixtures["solid"])
            raw["colorways"][0]["mapping"]["ground"] = "#0000FF"
        elif index == 2:
            raw["layers"] = [raw["layers"][0], raw["layers"][2]]
            raw["colorways"][0]["mapping"]["ground"] = "#FFFFFF"
        elif index in (4, 5, 6):
            raw["layers"] = raw["layers"][:2]
            raw["layers"][1]["params"]["angle"] = {4: 0, 5: 90, 6: 45}[index]
        elif index in (7, 8):
            raw["layers"] = [raw["layers"][0], raw["layers"][2]]
            if index == 7:
                raw["layers"][1]["placement"] = {
                    "type": "scatter",
                    "scatter": {"mode": "poisson", "count": 12, "min_dist_mm": 4},
                }
            else:
                raw["layers"][1]["placement"]["lattice"]["drop_fraction"] = 0.5
        return raw
    changes = {
        9: {"background": {"color": "#FF0000"}},
        10: {"palette": {"slots": [{"id": "stripe", "hex": "#000000"}]}},
        11: {"placement": {"slot": 1, "rotation_deg": 45}},
        12: {"placement": {"slot": 2, "rotation_deg": 90}},
        13: {"motif_size_mm": [2, 4]},
        14: {"placement": {"slot": 1, "count_per_axis": 2}},
        15: {"placement": {"slot": 1, "count_per_axis": 6}},
        16: {"stripe": {"bands": []}},
        17: {"placement": {"slot": 1, "arrangement": "on_stripes"}},
        18: {"placement": {"slot": 1, "arrangement": "between_stripes"}},
        19: {"scale": 2},
        20: {"scale": 0.5},
        21: {"motif_size_mm": [4, 6]},
        22: {"background": {"color": "#FF0000"}},
        23: {"placement": {"slot": 1, "rotation_deg": 0}},
        24: {"placement": {"arrangement": "scatter", "count_per_axis": 6}},
        25: {"placement": {"slot": 1, "arrangement": "staggered"}},
        26: {"placement": {"slot": 2, "count_per_axis": 2}},
    }
    return apply_patch(raw, DesignPatchV1.model_validate({"note": "test", **changes[index]}))


def test_all_criteria_have_satisfying_candidates_and_cli_can_validate():
    data = corpus()
    assert len(data.cases) == len({c.prompt for c in data.cases}) == 30
    observations = [
        scoring.Observation(case_id=c.id, intent=candidate(i))
        if i <= 26
        else scoring.Observation(case_id=c.id, rejection=c.checks[0].value)
        for i, c in enumerate(data.cases, 1)
    ]
    report = scoring.evaluate(data, observations)
    assert report["passed"] == 30, report["cases"]
    assert report["by_mode"]["edit"] == {"passed": 18, "total": 18}
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--check-corpus"],
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(result.stdout)["model_evaluated"] is False


def test_wrong_color_binding_does_not_pass_a_valid_intent():
    raw = candidate(4)
    raw["colorways"][0]["mapping"] = {"ground": "#FFFFFF", "stripe": "#000080"}
    assert one_case(4, raw)["passed"] == 0
    raw = candidate(4)
    raw["palette"]["slots"][0]["hex"] = "#FF0000"
    assert one_case(4, raw)["passed"] == 1  # Actual colorway is authoritative.
    raw["colorways"][0]["mapping"]["stripe"] = "#fff"
    assert one_case(4, raw)["passed"] == 1


def test_missing_subject_wrong_lane_and_non_target_edit_fail():
    raw = candidate(18)
    raw["layers"] = [layer for layer in raw["layers"] if layer["id"] != "circle"]
    assert one_case(18, raw)["passed"] == 0
    assert one_case(18, candidate(17))["passed"] == 0
    raw = candidate(18)
    raw["layers"][2]["opacity"] = 0
    assert one_case(18, raw)["passed"] == 0
    raw = candidate(11)
    raw["layers"][3]["params"]["size_mm"] = 2
    assert one_case(11, raw)["passed"] == 0
    assert one_case(22, candidate(9))["passed"] == 0  # Lost the previous 45-degree edit.


def test_actual_count_is_scored_and_no_change_is_not_a_relative_improvement():
    raw = candidate(7)
    raw["layers"][1]["placement"]["scatter"] = {
        "mode": "poisson",
        "count": 30,
        "min_dist_mm": 8,
    }
    observed = scoring.facts(scoring.Observation(case_id="sample", intent=raw, seed=0), corpus())
    assert observed["motif.eval-circle.count"] == 22
    assert observed["motif.eval-circle.count_fulfilled"] is False
    assert one_case(7, raw)["passed"] == 0
    assert one_case(14, corpus().fixtures["base"])["passed"] == 0


def test_missing_invalid_and_wrongly_rejected_outputs_stay_in_denominator(tmp_path):
    data = corpus()
    assert scoring.evaluate(data, [])["total"] == 30
    assert scoring.evaluate(data, [])["passed"] == 0
    assert one_case(1, rejection="motif_change")["passed"] == 0
    assert one_case(27, rejection="target_missing")["passed"] == 0
    assert one_case(27, intent=candidate(3))["passed"] == 0
    assert one_case(1, intent={})["passed"] == 0
    outputs = tmp_path / "observations.json"
    outputs.write_text("[]")
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--outputs", str(outputs)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    report = json.loads(result.stdout)
    assert report["total"] == 30 and report["passed"] == 0
    assert "prompt" not in result.stdout
    outputs.write_text('[{"case_id":"secret-prompt", "unexpected":"private-value"}]')
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--outputs", str(outputs)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "private-value" not in result.stdout + result.stderr


def test_reject_malformed_evaluation_inputs():
    with pytest.raises(ValueError):
        scoring.Observation(case_id="x", intent={}, rejection="motif_change")
    data = corpus()
    item = scoring.Observation(case_id=data.cases[0].id, intent={})
    with pytest.raises(ValueError, match="duplicate"):
        scoring.evaluate(data, [item, item])
    with pytest.raises(ValueError, match="unknown"):
        scoring.evaluate(data, [scoring.Observation(case_id="unknown", intent={})])
    data.cases[0].checks[0].fact = "background.colour_typo"
    with pytest.raises(ValueError, match="unknown fact"):
        scoring.validate_corpus(data)
