"""The scorer must distinguish valid-but-wrong designs from satisfying candidates."""

import copy
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from shutil import which

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
    if index >= 38:  # 대화 체인 — baseline이 fixture가 아니라 직전 턴이다
        return _chain_candidate(index)
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
    if index <= 26:
        return apply_patch(raw, DesignPatchV1.model_validate({"note": "test", **changes[index]}))
    return _added_candidate(index)


def _recolor(raw, slot, hex_value):
    """슬롯 hex와 default colorway 매핑을 함께 바꾼다 — 채점은 colorway 해석색을 본다."""
    for item in raw["palette"]["slots"]:
        if item["id"] == slot:
            item["hex"] = hex_value
    raw["colorways"][0]["mapping"][slot] = hex_value
    return raw


def _added_candidate(index):
    """031~037(2026-09-09 추가)의 충족 가능 후보 — 손으로 지정한 값이지 모델 출력이 아니다."""
    raw = copy.deepcopy(corpus().fixtures["base"])
    if index in (31, 32, 33, 34, 35):
        raw["layers"] = raw["layers"][:2]  # 배경 + 줄무늬
    if index == 31:
        return _recolor(raw, "stripe", "#FFD700")
    if index == 32:
        return raw
    if index == 33:
        params = raw["layers"][1]["params"]
        raw["palette"]["slots"].append({"id": "accent", "hex": "#FFD700"})
        raw["colorways"][0]["mapping"]["accent"] = "#FFD700"
        params["bands"] = [
            {"offset_mm": 0.0, "width_mm": 4.0, "color": "stripe"},
            {"offset_mm": 6.0, "width_mm": 1.5, "color": "accent"},
        ]
        return raw
    if index == 34:
        return _recolor(raw, "ground", "#F5F0E6")
    if index == 35:
        raw["layers"] = [raw["layers"][0], *copy.deepcopy(corpus().fixtures["base"])["layers"][2:]]
        return raw
    patch = {
        36: {"motif_size_mm": [6.0, 2.0]},
        37: {"placement": {"slot": 2, "arrangement": "on_stripes"}},
    }[index]
    return apply_patch(raw, DesignPatchV1.model_validate({"note": "test", **patch}))


def _chain_candidate(index):
    """038~043(대화 체인)의 후보 — 각 턴은 **직전 턴 후보**에서 출발한다."""
    base = copy.deepcopy(corpus().fixtures["base"])
    base["layers"] = [base["layers"][0], *base["layers"][2:]]  # 줄무늬 없는 두 모티프 격자
    if index == 38:
        return base
    if index == 39:
        return _recolor(_chain_candidate(38), "ground", "#FF0000")
    if index == 40:
        return apply_patch(
            _chain_candidate(39),
            DesignPatchV1.model_validate(
                {"note": "t", "placement": {"slot": 1, "rotation_deg": 45}}
            ),
        )
    single = copy.deepcopy(corpus().fixtures["base"])
    single["layers"] = [single["layers"][0], single["layers"][2]]
    single = _recolor(single, "ground", "#FFFFFF")
    if index == 41:
        return single
    denser = DesignPatchV1.model_validate(
        {"note": "t", "placement": {"count_per_axis": 6 if index == 42 else 8}}
    )
    return apply_patch(_chain_candidate(41) if index == 42 else _chain_candidate(42), denser)


def _observation(index, case, data):
    if case.mode == "reject":
        return scoring.Observation(case_id=case.id, rejection=case.checks[0].value)
    if index < 44:
        return scoring.Observation(case_id=case.id, intent=candidate(index))
    # 카탈로그 검색 사례 — 그림은 DB에 있으므로 수집 단계가 symbol·subject를 실어온다.
    subject = {44: "cat", 45: "동백꽃", 46: "horse"}[index]
    motif_id = f"catalog-{index}"
    raw = copy.deepcopy(data.fixtures["base"])
    raw["layers"] = [raw["layers"][0], raw["layers"][2]]
    raw["layers"][1]["params"]["motif_id"] = motif_id
    if index == 46:
        raw = _recolor(raw, "ground", "#000080")
    return scoring.Observation(
        case_id=case.id,
        intent=raw,
        motifs={motif_id: data.motifs["eval-circle"]},
        motif_subjects={motif_id: subject},
        approximate_match=False,
    )


def test_all_criteria_have_satisfying_candidates_and_cli_can_validate():
    data = corpus()
    assert len(data.cases) == len({c.prompt for c in data.cases}) == 46
    observations = [_observation(i, c, data) for i, c in enumerate(data.cases, 1)]
    report = scoring.evaluate(data, observations)
    assert report["passed"] == 46, report["cases"]
    assert report["by_mode"]["edit"] == {"passed": 24, "total": 24}
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
    assert scoring.evaluate(data, [])["total"] == len(data.cases)
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
    assert report["total"] == len(data.cases) and report["passed"] == 0
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


def _scattered(seed_salts: tuple[str | None, str | None]):
    """Both motif slots scattered with one identical spec — the shape the global patch produces."""
    raw = copy.deepcopy(corpus().fixtures["base"])
    for layer, salt in zip(raw["layers"][2:], seed_salts, strict=True):
        scatter = {"mode": "poisson", "min_dist_mm": 8, "count": 12}
        if salt is not None:
            scatter["seed_salt"] = salt
        layer["placement"] = {"type": "scatter", "scatter": scatter}
    return scoring.facts(scoring.Observation(case_id="sample", intent=raw), corpus())


def test_stacked_slots_are_scored_as_overlapping_shapes():
    stacked = _scattered((None, None))
    separated = _scattered(("circle", "star"))

    # Same stream: every star sits exactly on a circle (clones add a few more pairs).
    assert stacked["motif.overlaps"] >= stacked["motif.eval-circle.count"]
    assert stacked["motif.eval-circle.self_overlaps"] == 0
    assert separated["motif.overlaps"] < stacked["motif.overlaps"]


def test_lane_conditions_score_the_whole_shape_not_only_the_center():
    """`between_stripes`는 중심만이 아니라 도형 전체가 빈 공간에 들어가야 참이다."""
    fitting = scoring.facts(scoring.Observation(case_id="sample", intent=candidate(18)), corpus())
    assert fitting["motif.eval-circle.lane"] == "b0.gap"
    assert fitting["motif.eval-circle.lane_contains_shape"] is True

    raw = candidate(18)
    raw["layers"][2]["params"]["size_mm"] = 14.0  # 줄 사이를 넘칠 만큼 키운다
    spilling = scoring.facts(scoring.Observation(case_id="sample", intent=raw), corpus())
    assert spilling["motif.eval-circle.lane"] == "b0.gap"
    assert spilling["motif.eval-circle.lane_contains_shape"] is False
    # 경계 반대편 이웃까지 포함해 겹침을 센다 — 클론이 원본과 겹치면 잡힌다.
    assert spilling["motif.eval-circle.self_overlaps"] > 0


_RENDERER = which("rsvg-convert") or which("resvg")


@pytest.mark.skipif(_RENDERER is None, reason="rsvg-convert/resvg not available")
def test_alpha_mask_stage_filters_aabb_false_positives():
    """AABB는 과대추정이다 — 마스크 2단계는 후보를 줄이되 진짜 겹침은 남긴다."""
    stacked = copy.deepcopy(corpus().fixtures["base"])
    for layer in stacked["layers"][2:]:  # 두 모티프를 같은 격자에 정확히 포갠다
        layer["placement"] = {"type": "lattice", "lattice": {"cell_w_mm": 12, "cell_h_mm": 12}}
    observation = scoring.Observation(case_id="sample", intent=stacked)
    facts = scoring.facts(observation, corpus(), ink=True)
    assert facts["motif.ink_overlaps"] > 0

    sparse = copy.deepcopy(corpus().fixtures["base"])
    for layer in sparse["layers"][2:]:
        layer["placement"] = {
            "type": "scatter",
            "scatter": {"mode": "poisson", "min_dist_mm": 8, "count": 12},
        }
        layer["params"]["size_mm"] = 7.0  # AABB는 서로 닿지만 실제 잉크는 덜 겹친다
    loose = scoring.facts(scoring.Observation(case_id="sample", intent=sparse), corpus(), ink=True)
    assert loose["motif.overlaps"] > loose["motif.ink_overlaps"]
    # 렌더러 없이 돌린 채점은 이 사실을 만들지 않는다 — 조건이 조용히 통과하지 않는다.
    assert "motif.ink_overlaps" not in scoring.facts(observation, corpus())


def test_absolute_bounds_reject_values_outside_the_range():
    """`lte`/`gte`는 경계값을 포함하고 그 바깥은 떨어뜨린다 — 002의 '아주 작게' 조건."""
    raw = candidate(2)
    assert one_case(2, raw)["passed"] == 1
    raw["layers"][1]["params"]["size_mm"] = 6.0  # 48 × 0.125 — 갤러리의 "작은 모티프", 경계 통과
    assert one_case(2, raw)["passed"] == 1
    raw["layers"][1]["params"]["size_mm"] = 8.0  # v1 실모델이 낸 값 — 작지 않다
    assert one_case(2, raw)["passed"] == 0
    with pytest.raises(ValueError, match="numeric bound"):
        scoring.Check(fact="tile_mm", op="lte", value="48")
    with pytest.raises(ValueError, match="requires a non-null value"):
        scoring.Check(fact="tile_mm", op="gte")
