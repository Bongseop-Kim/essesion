"""갤러리 시드 계약 — 큐레이션 목록과 시드가 만드는 run 페이로드의 형태."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

from worker.authoring.examples import load_example_set
from worker.motifs.registry import MotifDef

GOLDEN = Path(__file__).parent / "golden"
SCRIPT = Path(__file__).parents[1] / "scripts/seed_design_examples.py"


def _seed_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("seed_design_examples", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _catalog() -> dict[str, MotifDef]:
    dump = json.loads((GOLDEN / "motifs.json").read_text(encoding="utf-8"))
    return {
        motif_id: MotifDef(
            id=motif_id,
            symbol=spec["symbol"],
            bbox_mm=tuple(spec["bbox_mm"]),
            anchor=tuple(spec["anchor"]),
        )
        for motif_id, spec in dump.items()
    }


def test_every_curated_example_supplies_one_motif_subject_per_plan_input():
    seed = _seed_module()
    examples = {example.example_id: example for example in load_example_set()}

    assert len(seed.CURATED) == len({item.example_id for item in seed.CURATED})
    for curated in seed.CURATED:
        assert curated.plan is not None or curated.example_id in examples
        inputs = [
            source for source in seed.plan_for(curated, examples).motifs if source.source == "input"
        ]
        assert len(curated.motif_subjects) == len(inputs), curated.example_id


def test_seeded_runs_are_deterministic_and_carry_what_the_api_restores():
    # api `_resolve_design_run`은 로그의 design.intent/seed/colorway_id만 보고 세션을
    # 되살린다 — 시드가 그 셋을 빠뜨리면 갤러리 카드가 열리지 않는다.
    seed = _seed_module()
    examples = {example.example_id: example for example in load_example_set()}
    catalog = _catalog()
    motif_pool = sorted(catalog)

    for curated in seed.CURATED:
        motif_ids = motif_pool[: len(curated.motif_subjects)]
        plan = seed.plan_for(curated, examples)
        first = seed._compose_run(plan, motif_ids=motif_ids, catalog=catalog, color_names=())
        second = seed._compose_run(plan, motif_ids=motif_ids, catalog=catalog, color_names=())

        assert first == second
        intent_log, design_log, _warnings = first
        assert isinstance(intent_log["resolved_plan"], dict)
        assert isinstance(design_log["intent"], dict)
        assert isinstance(design_log["seed"], int)
        assert design_log["colorway_id"] == "default"
        assert design_log["svg"].startswith("<svg")


def test_placement_templates_carry_panel_svg_and_one_logo():
    # 배치형 템플릿 — panel이 intent·로그에 실리고 포인트 로고는 panel에 하나뿐이다.
    seed = _seed_module()
    catalog = _catalog()
    motif_id = sorted(catalog)[0]
    placed = [item for item in seed.CURATED if item.panel]
    assert len(placed) == 6
    for curated in placed:
        panel = [
            {**{k: v for k, v in element.items() if k != "subject"}, "motif_id": motif_id}
            if "subject" in element
            else dict(element)
            for element in curated.panel
        ]
        assert sum(1 for element in panel if element.get("role") == "logo") == 1
        _intent, design_log, warnings = seed._compose_run(
            curated.plan, motif_ids=[], catalog=catalog, color_names=(), panel=panel
        )
        assert warnings == [], curated.example_id
        assert design_log["panel_svg"].startswith("<svg")
        assert design_log["intent"]["panel"][0]["type"] == panel[0]["type"]
