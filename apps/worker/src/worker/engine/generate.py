"""단일 후보 파이프라인 — intent → validate → compose → seamless 가드 (worker-engine.md §7).

래스터화는 여기서 하지 않는다 — generate는 순수·byte-결정론.
"""

from dataclasses import dataclass, field

from worker.engine.composition import compose
from worker.engine.determinism import REGISTRY_VERSION, ReproMeta, layout_id_for
from worker.engine.seamless import assert_seamless_invariants
from worker.engine.validate import validate_intent
from worker.motifs.registry import MotifCatalog


@dataclass(frozen=True)
class Candidate:
    svg: str
    repro: ReproMeta
    warnings: list[str] = field(default_factory=list)
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
    repro = ReproMeta(
        intent_version=intent.intent_version,
        seed=effective_seed,
        colorway_id=colorway_id,
        layout_id=layout_id,
        registry_version=registry_version,
    )
    return Candidate(svg=svg, repro=repro, warnings=list(result.warnings), layout_id=layout_id)
