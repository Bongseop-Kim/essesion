"""골든 픽스처 로더 — 결정론 계약의 채점표 (docs/api-spec/worker-pipeline.md §6)."""

import json
from pathlib import Path

from worker.motifs.registry import MotifDef, register_motif

GOLDEN = Path(__file__).parent / "golden"


def register_golden_motifs() -> None:
    """골든 intent들이 참조하는 모티프 정의 덤프를 레지스트리에 등록."""
    dump = json.loads((GOLDEN / "motifs.json").read_text())
    for motif_id, spec in dump.items():
        register_motif(
            MotifDef(
                id=motif_id,
                symbol=spec["symbol"],
                bbox_mm=tuple(spec["bbox_mm"]),
                anchor=tuple(spec["anchor"]),
            )
        )


def golden_intents() -> list[tuple[str, dict]]:
    return [
        (path.stem, json.loads(path.read_text()))
        for path in sorted((GOLDEN / "json").glob("*.json"))
    ]


def golden_svg(stem: str) -> str:
    return (GOLDEN / "svg" / f"{stem}.svg").read_text()
