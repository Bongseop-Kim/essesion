"""intent 1개 → 디자인 1개 합성 (worker-engine.md §4).

후보 팬아웃(layout×colorway×seed 변주)은 폐기됐다 — 한 번의 생성은 디자인 하나를
만들고, 변주는 사용자의 다음 문장이 만든다.
"""

from dataclasses import dataclass

from worker.engine.composition import compose
from worker.engine.constraints import (
    PaletteConstraint,
    PatternConstraints,
    assert_constraints_satisfied,
)
from worker.engine.determinism import layout_id_for, stable_digest
from worker.engine.intent import Intent
from worker.engine.seamless import assert_seamless_invariants
from worker.engine.validate import validate_intent
from worker.motifs.registry import MotifCatalog

SOURCE_FIDELITY_VECTOR = "vector"


@dataclass(frozen=True)
class ComposedDesign:
    id: str
    svg: str
    layout_id: str
    intent: Intent
    colorway_id: str
    seed: int
    source_fidelity: str
    warnings: list[str]


def _design_id(layout_id: str, colorway_id: str, seed: int) -> str:
    return stable_digest(f"{layout_id}:{colorway_id}:{seed}".encode(), 16)


def compose_design(
    base_raw,
    *,
    seed: int | None = None,
    colorway: str | None = None,
    motifs: MotifCatalog | None = None,
    palette_constraint: PaletteConstraint | None = None,
    pattern_constraints: PatternConstraints | None = None,
) -> ComposedDesign:
    """검증된 intent를 하나의 SVG로 합성한다. 같은 intent+seed → byte-identical."""

    base = validate_intent(base_raw, motifs=motifs)
    intent = base.intent
    assert_seamless_invariants(intent)
    if palette_constraint is not None and pattern_constraints is not None:
        assert_constraints_satisfied(
            intent, palette=palette_constraint, pattern=pattern_constraints
        )

    available = [cw.id for cw in intent.colorways]
    if colorway is not None:
        if colorway not in available:
            raise ValueError(f"unknown colorway {colorway!r}; available: {available}")
        colorway_id = colorway
    else:
        # 색 수가 가장 적은 컬러웨이(동수면 id 순) — 후보 랭킹이 쓰던 기준을 유지한다.
        colorway_id = min(available, key=lambda cw: (len(base.palette.distinct_colors(cw)), cw))

    effective_seed = intent.seed if seed is None else int(seed)
    intent = intent.model_copy(update={"seed": effective_seed})
    layout_id = layout_id_for(intent)
    return ComposedDesign(
        id=_design_id(layout_id, colorway_id, effective_seed),
        svg=compose(intent, base.palette, colorway_id, motifs=motifs),
        layout_id=layout_id,
        intent=intent,
        colorway_id=colorway_id,
        seed=effective_seed,
        source_fidelity=SOURCE_FIDELITY_VECTOR,
        warnings=list(base.warnings),
    )
