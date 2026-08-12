"""Pure contracts for the paid motif adapter pilot harness."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

SCRIPT = Path(__file__).parents[1] / "scripts/eval_motif_adapters.py"


def _eval_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("eval_motif_adapters", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_eval_corpus_has_twenty_cases_and_five_stroke_risks():
    evaluation = _eval_module()

    assert len(evaluation.CASES) == 20
    assert sum(case.stroke_risk for case in evaluation.CASES) >= 5
    assert len({case.case_id for case in evaluation.CASES}) == len(evaluation.CASES)


def test_svg_metrics_report_absolute_counts_and_budget_ratios():
    evaluation = _eval_module()
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
        '<path d="M0 0L1 1Z"/><path d="M2 2C3 3 4 4 5 5Z"/></svg>'
    )

    metrics = evaluation._metrics(svg)

    assert (metrics.nodes, metrics.paths, metrics.path_commands) == (3, 2, 6)
    assert metrics.node_budget_ratio == round(3 / evaluation.MAX_MOTIF_NODES, 4)
    assert metrics.path_budget_ratio == round(2 / evaluation.MAX_MOTIF_PATHS, 4)


def test_gallery_escapes_provider_errors(tmp_path):
    evaluation = _eval_module()
    case = evaluation.EvalCase("case-01", "safe subject")
    result = evaluation.EvalResult(
        case_id=case.case_id,
        subject=case.subject,
        stroke_risk=False,
        adapter="recraft",
        passed=False,
        attempts=1,
        elapsed_seconds=0.1,
        error="<script>alert(1)</script>",
    )

    evaluation._write_gallery([result], [case], tmp_path)
    gallery = (tmp_path / "gallery.html").read_text(encoding="utf-8")

    assert "<script>alert(1)</script>" not in gallery
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in gallery
