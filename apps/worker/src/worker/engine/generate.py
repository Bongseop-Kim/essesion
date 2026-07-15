"""단일 후보 파이프라인 — intent → validate → compose → seamless 가드 (worker-engine.md §7).

래스터화는 여기서 하지 않는다 — generate는 순수·byte-결정론.
"""

from dataclasses import dataclass

from worker.engine.composition import compose
from worker.engine.determinism import REGISTRY_VERSION, layout_id_for
from worker.engine.seamless import assert_seamless_invariants
from worker.engine.validate import validate_intent
from worker.motifs.registry import MotifCatalog


@dataclass(frozen=True)
class Candidate:
    svg: str
    layout_id: str | None = None


def generate(
    raw,
    *,
    colorway_id: str = "default",
    seed: int | None = None,
    registry_version: str = REGISTRY_VERSION,
    motifs: MotifCatalog | None = None,
) -> Candidate:
    result = validate_intent(raw, motifs=motifs)
    effective_seed = result.intent.seed if seed is None else seed
    intent = result.intent.model_copy(update={"seed": effective_seed})
    assert_seamless_invariants(intent)
    svg = compose(intent, result.palette, colorway_id, motifs=motifs)
    layout_id = layout_id_for(intent)
    return Candidate(svg=svg, layout_id=layout_id)
