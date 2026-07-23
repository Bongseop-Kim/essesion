"""후보 다양화·랭킹·de-dup — layout×colorway×seed 3축 (worker-engine.md §4)."""

from collections.abc import Iterator
from dataclasses import dataclass, replace
from typing import cast

from worker.engine.composition import compose
from worker.engine.constraints import (
    PaletteConstraint,
    PatternConstraints,
    assert_constraints_satisfied,
)
from worker.engine.determinism import REGISTRY_VERSION, layout_id_for, stable_digest
from worker.engine.generate import Candidate
from worker.engine.intent import (
    Band,
    Intent,
    LatticeSpec,
    MotifLayer,
    Placement,
    StripeLayer,
)
from worker.engine.palette import Palette
from worker.engine.seamless import assert_seamless_invariants
from worker.engine.validate import IntentInvalid, validate_intent
from worker.motifs.registry import MotifCatalog

DEFAULT_CANDIDATE_COUNT = 4
MAX_CANDIDATE_COUNT = 8
SOURCE_FIDELITY_VECTOR = "vector"

_DROP_FRACTIONS: tuple[float | None, ...] = (None, 0.5, 1.0 / 3.0, 0.25)
_PLACEMENT_RANK = {"path_following": 2, "lattice": 1, "point_set": 1, "scatter": 0}

# (밴드 가중치, 밴드 사이 gap 가중치) — 한 period를 정확히 분할하는 리듬 프리셋
_STRIPE_RHYTHMS_SINGLE: tuple[tuple[tuple[float, ...], float], ...] = (
    ((5.0, 2.0, 2.0), 0.5),
    ((3.0, 2.0, 1.0), 0.6),
)
_STRIPE_RHYTHMS_MULTI: tuple[tuple[tuple[float, ...], float], ...] = (
    ((5.0, 11.0), 0.4),
    ((6.0, 1.0, 3.0), 0.4),
)


@dataclass(frozen=True)
class RankedCandidate:
    id: str
    candidate: Candidate
    intent: Intent
    colorway_id: str
    seed: int
    source_fidelity: str
    rank_key: tuple
    design_index: int = 0


@dataclass(frozen=True)
class CandidateSet:
    candidates: list[RankedCandidate]
    warnings: list[str]
    available_strategy_count: int


def _candidate_id(layout_id: str, colorway_id: str, seed: int, design_index: int = 0) -> str:
    key = layout_id if design_index == 0 else f"{design_index}:{layout_id}"
    raw = f"{key}:{colorway_id}:{seed}".encode()
    return stable_digest(raw, 16)


def _clustering_score(intent: Intent) -> int:
    score = 0
    for layer in intent.layers:
        placement = getattr(layer, "placement", None)
        if placement is not None:
            score += _PLACEMENT_RANK.get(placement.type, 0)
    return score


def _has_scatter(intent: Intent) -> bool:
    for layer in intent.layers:
        placement = getattr(layer, "placement", None)
        if placement is not None and placement.type == "scatter":
            return True
    return False


def generate_candidates(
    base_raw,
    *,
    candidate_count: int = DEFAULT_CANDIDATE_COUNT,
    seed: int | None = None,
    colorway: str | None = None,
    source_fidelity: str = SOURCE_FIDELITY_VECTOR,
    registry_version: str = REGISTRY_VERSION,
    motifs: MotifCatalog | None = None,
    palette_constraint: PaletteConstraint | None = None,
    pattern_constraints: PatternConstraints | None = None,
) -> CandidateSet:
    count = max(1, min(int(candidate_count), MAX_CANDIDATE_COUNT))

    base = validate_intent(base_raw, motifs=motifs)
    base_intent = base.intent
    assert_seamless_invariants(base_intent)
    if palette_constraint is not None and pattern_constraints is not None:
        assert_constraints_satisfied(
            base_intent, palette=palette_constraint, pattern=pattern_constraints
        )
    warnings = list(base.warnings)

    available_cws = [cw.id for cw in base_intent.colorways]
    if colorway is not None:
        if colorway not in available_cws:
            raise ValueError(f"unknown colorway {colorway!r}; available: {available_cws}")
        colorways = [colorway]
    else:
        colorways = available_cws

    base_seed = base_intent.seed if seed is None else int(seed)

    # 1. layout 변이 — 각각 validate+불변식 통과, layout_id de-dup
    variants: list[tuple[str, Intent, Palette]] = []
    seen_layouts: set[str] = set()
    for variant in _layout_variants(base_intent, pattern_constraints=pattern_constraints):
        try:
            res = validate_intent(variant, motifs=motifs)
            assert_seamless_invariants(res.intent)
            if palette_constraint is not None and pattern_constraints is not None:
                assert_constraints_satisfied(
                    res.intent, palette=palette_constraint, pattern=pattern_constraints
                )
        except (IntentInvalid, AssertionError, ValueError):
            continue
        lid = layout_id_for(res.intent)
        if lid in seen_layouts:
            continue
        seen_layouts.add(lid)
        variants.append((lid, res.intent, res.palette))

    available_strategy_count = len(variants)

    # seed 축은 scatter가 있고 layout×colorway로 count를 못 채울 때만
    seeds = [base_seed]
    if _has_scatter(base_intent) and len(variants) * len(colorways) < count:
        seeds += [base_seed + i for i in range(1, count + 1)]

    # 2. 풀 생성
    pool: list[RankedCandidate] = []
    render_failures = 0
    for lid, intent_v, palette_v in variants:
        clustering = _clustering_score(intent_v)
        for cw in colorways:
            color_count = len(palette_v.distinct_colors(cw))
            for s in seeds:
                eff = intent_v.model_copy(update={"seed": s})
                try:
                    svg = compose(eff, palette_v, cw, motifs=motifs)
                except (AssertionError, ValueError, IntentInvalid):
                    render_failures += 1
                    continue
                pool.append(
                    RankedCandidate(
                        id=_candidate_id(lid, cw, s),
                        candidate=Candidate(svg=svg, layout_id=lid),
                        intent=eff,
                        colorway_id=cw,
                        seed=s,
                        source_fidelity=source_fidelity,
                        rank_key=(color_count, clustering, lid, cw, s),
                    )
                )
    if render_failures:
        warnings.append(f"{render_failures} candidate variant(s) failed to render and were dropped")

    # 3. SVG de-dup — rank 최소 대표 보존
    best_by_svg: dict[str, RankedCandidate] = {}
    for rc in pool:
        prev = best_by_svg.get(rc.candidate.svg)
        if prev is None or rc.rank_key < prev.rank_key:
            best_by_svg[rc.candidate.svg] = rc
    deduped = sorted(best_by_svg.values(), key=lambda rc: rc.rank_key)

    # 4. 선택 — pass1: distinct layout당 최상위, pass2: 잔여 채움
    selected: list[RankedCandidate] = []
    seen: set[str] = set()
    for rc in deduped:
        if len(selected) >= count:
            break
        lid = rc.candidate.layout_id or ""
        if lid not in seen:
            seen.add(lid)
            selected.append(rc)
    if len(selected) < count:
        chosen = {rc.id for rc in selected}
        for rc in deduped:
            if len(selected) >= count:
                break
            if rc.id not in chosen:
                selected.append(rc)
    selected.sort(key=lambda rc: rc.rank_key)

    # 5. 다양성/부분 경고
    distinct_selected = len({rc.candidate.layout_id for rc in selected})
    if count >= 2:
        required = min(2, available_strategy_count)
        if distinct_selected < required:
            warnings.append(
                f"diversity shortfall: {distinct_selected} distinct layout(s) < required {required}"
            )
    if len(selected) < count:
        warnings.append(
            f"partial: {len(selected)} candidate(s) available after de-dup (requested {count})"
        )

    return CandidateSet(
        candidates=selected,
        warnings=warnings,
        available_strategy_count=available_strategy_count,
    )


def generate_candidate_set(
    base_raws,
    *,
    candidate_count: int = DEFAULT_CANDIDATE_COUNT,
    seed: int | None = None,
    colorway: str | None = None,
    source_fidelity: str = SOURCE_FIDELITY_VECTOR,
    registry_version: str = REGISTRY_VERSION,
    motifs: MotifCatalog | None = None,
    palette_constraint: PaletteConstraint | None = None,
    pattern_constraints: PatternConstraints | None = None,
) -> CandidateSet:
    """복수 디자인을 다양화·병합 — 전역 SVG de-dup 후 round-robin 선택."""
    count = max(1, min(int(candidate_count), MAX_CANDIDATE_COUNT))
    designs = list(base_raws)

    warnings: list[str] = []
    per_design: list[list[RankedCandidate]] = []
    available = 0
    last_exc: Exception | None = None
    for i, base_raw in enumerate(designs):
        try:
            cs = generate_candidates(
                base_raw,
                candidate_count=count,
                seed=seed,
                colorway=colorway,
                source_fidelity=source_fidelity,
                registry_version=registry_version,
                motifs=motifs,
                palette_constraint=palette_constraint,
                pattern_constraints=pattern_constraints,
            )
        except (IntentInvalid, AssertionError, ValueError) as exc:
            last_exc = exc
            warnings.append(f"design {i} dropped: {exc}")
            continue
        tagged = [
            replace(
                rc,
                design_index=i,
                id=_candidate_id(rc.candidate.layout_id or "", rc.colorway_id, rc.seed, i),
            )
            for rc in cs.candidates
        ]
        per_design.append(tagged)
        warnings.extend(
            w for w in cs.warnings if not w.startswith(("diversity shortfall:", "partial:"))
        )
        available += cs.available_strategy_count

    if not per_design:
        if last_exc is not None:
            raise last_exc
        raise ValueError("no base intents to generate candidates from")

    best_by_svg: dict[str, RankedCandidate] = {}
    for rc in (rc for design in per_design for rc in design):
        prev = best_by_svg.get(rc.candidate.svg)
        if prev is None or (rc.rank_key, rc.design_index) < (prev.rank_key, prev.design_index):
            best_by_svg[rc.candidate.svg] = rc

    groups_by_design: dict[int, list[RankedCandidate]] = {}
    for rc in sorted(best_by_svg.values(), key=lambda rc: (rc.design_index, rc.rank_key)):
        groups_by_design.setdefault(rc.design_index, []).append(rc)
    groups = [groups_by_design[d] for d in sorted(groups_by_design)]

    selected: list[RankedCandidate] = []
    cursors = [0] * len(groups)
    progressed = True
    while len(selected) < count and progressed:
        progressed = False
        for gi, group in enumerate(groups):
            if len(selected) >= count:
                break
            if cursors[gi] < len(group):
                selected.append(group[cursors[gi]])
                cursors[gi] += 1
                progressed = True
    selected.sort(key=lambda rc: rc.rank_key)

    distinct_designs = len({rc.design_index for rc in selected})
    if count >= 2:
        required = min(2, len(per_design), available)
        if distinct_designs < required:
            warnings.append(
                f"diversity shortfall: {distinct_designs} distinct design(s) < required {required}"
            )
    if len(selected) < count:
        warnings.append(
            f"partial: {len(selected)} candidate(s) available after de-dup (requested {count})"
        )

    warnings = list(dict.fromkeys(warnings))
    return CandidateSet(candidates=selected, warnings=warnings, available_strategy_count=available)


# ---- layout 변이 생성기 ----


def _q(value: float) -> float:
    return round(float(value), 6)


def _layout_variants(
    base: Intent, *, pattern_constraints: PatternConstraints | None = None
) -> Iterator[Intent]:
    """결정론적 layout 변이 (identity 먼저)."""
    locked_scale = bool(
        pattern_constraints is not None and pattern_constraints.motif_scale != "auto"
    )
    locked_density = bool(pattern_constraints is not None and pattern_constraints.density != "auto")
    locked_arrangement = bool(
        pattern_constraints is not None and pattern_constraints.arrangement != "auto"
    )
    yield base
    for idx, layer in enumerate(base.layers):
        if layer.type == "stripe":
            if not locked_density:
                yield from _stripe_variants(base, idx)
            continue
        if not _is_lattice_layer(layer):
            placement = getattr(layer, "placement", None)
            if (
                layer.type == "motif"
                and placement is not None
                and placement.type == "path_following"
            ):
                if not locked_density:
                    for spacing in (placement.spacing_mm * 0.75, placement.spacing_mm * 1.5):
                        updated_layers = list(base.layers)
                        updated_layers[idx] = layer.model_copy(
                            update={
                                "placement": placement.model_copy(
                                    update={"spacing_mm": _q(spacing)}
                                )
                            }
                        )
                        yield base.model_copy(update={"layers": updated_layers})
                if not locked_scale:
                    yield from _motif_size_variants(base, idx)
            continue
        _, lattice = _lattice_of(cast("MotifLayer", layer))
        current = lattice.drop_fraction
        if not locked_arrangement:
            for frac in _DROP_FRACTIONS:
                if frac == current:
                    continue
                yield _with_lattice_drop(base, idx, frac)
        if not locked_density:
            yield from _lattice_cell_variants(base, idx)
        if not locked_scale:
            yield from _motif_size_variants(base, idx)


def _lattice_of(layer: MotifLayer) -> tuple[Placement, LatticeSpec]:
    """lattice placement이 검증된 경로에서만 호출 — 타입 내로잉용."""
    placement = layer.placement
    assert placement is not None and placement.lattice is not None
    return placement, placement.lattice


def _stripe_variants(base: Intent, layer_idx: int) -> Iterator[Intent]:
    layer = cast("StripeLayer", base.layers[layer_idx])
    params = layer.params
    if len(params.bands) == 1:
        current = params.bands[0].width_mm / params.period_mm
        for ratio in (0.35, 0.65):
            if abs(ratio - current) > 1e-6:
                yield _with_stripe_band_ratio(base, layer_idx, ratio)
        rhythms = _STRIPE_RHYTHMS_SINGLE
    else:
        rhythms = _STRIPE_RHYTHMS_MULTI
    for weights, gap in rhythms:
        yield _with_stripe_rhythm(base, layer_idx, weights, gap)


def _with_stripe_band_ratio(base: Intent, layer_idx: int, ratio: float) -> Intent:
    layer = cast("StripeLayer", base.layers[layer_idx])
    params = layer.params
    band = params.bands[0]
    updated_band = band.model_copy(update={"width_mm": _q(params.period_mm * ratio)})
    updated_layers = list(base.layers)
    updated_layers[layer_idx] = layer.model_copy(
        update={"params": params.model_copy(update={"bands": [updated_band]})}
    )
    return base.model_copy(update={"layers": updated_layers})


def _with_stripe_rhythm(
    base: Intent, layer_idx: int, weights: tuple[float, ...], gap_weight: float
) -> Intent:
    """리듬 프리셋으로 밴드 재구성 — period/angle 불변, 색은 기존 순환."""
    layer = cast("StripeLayer", base.layers[layer_idx])
    params = layer.params
    period = params.period_mm
    base_colors = [b.color for b in params.bands]
    n = len(weights)
    total = sum(weights) + gap_weight * (n - 1)
    u = period / total
    bands: list[Band] = []
    cursor = 0.0
    for i, w in enumerate(weights):
        width = w * u
        bands.append(
            Band(offset_mm=_q(cursor), width_mm=_q(width), color=base_colors[i % len(base_colors)])
        )
        cursor += width
        if i < n - 1:
            cursor += gap_weight * u
    updated_layers = list(base.layers)
    updated_layers[layer_idx] = layer.model_copy(
        update={"params": params.model_copy(update={"bands": bands})}
    )
    return base.model_copy(update={"layers": updated_layers})


def _lattice_cell_variants(base: Intent, layer_idx: int) -> Iterator[Intent]:
    layer = cast("MotifLayer", base.layers[layer_idx])
    _, spec = _lattice_of(layer)
    tile = base.canvas.tile_mm
    nx = max(1, round(tile / spec.cell_w_mm))
    ny = max(1, round(tile / spec.cell_h_mm))
    for nxx, nyy in ((nx + 1, ny + 1), (max(1, nx - 1), max(1, ny - 1))):
        if nxx == nx and nyy == ny:
            continue
        yield _with_lattice_cells(base, layer_idx, tile / nxx, tile / nyy)


def _with_lattice_cells(base: Intent, layer_idx: int, cell_w: float, cell_h: float) -> Intent:
    layer = cast("MotifLayer", base.layers[layer_idx])
    placement, spec = _lattice_of(layer)
    updated_layers = list(base.layers)
    updated_layers[layer_idx] = layer.model_copy(
        update={
            "placement": placement.model_copy(
                update={
                    "lattice": spec.model_copy(
                        update={"cell_w_mm": _q(cell_w), "cell_h_mm": _q(cell_h)}
                    )
                }
            )
        }
    )
    return base.model_copy(update={"layers": updated_layers})


def _motif_size_variants(base: Intent, layer_idx: int) -> Iterator[Intent]:
    layer = cast("MotifLayer", base.layers[layer_idx])
    size = layer.params.size_mm
    for factor in (0.75, 1.35):
        new_size = min(base.canvas.tile_mm, size * factor)
        if abs(new_size - size) > 1e-6:
            yield _with_motif_size(base, layer_idx, new_size)


def _with_motif_size(base: Intent, layer_idx: int, size: float) -> Intent:
    layer = cast("MotifLayer", base.layers[layer_idx])
    updated_layers = list(base.layers)
    updated_layers[layer_idx] = layer.model_copy(
        update={"params": layer.params.model_copy(update={"size_mm": _q(size)})}
    )
    return base.model_copy(update={"layers": updated_layers})


def _with_lattice_drop(base: Intent, layer_idx: int, frac: float | None) -> Intent:
    layer = cast("MotifLayer", base.layers[layer_idx])
    placement, lattice = _lattice_of(layer)
    updated_layers = list(base.layers)
    updated_layers[layer_idx] = layer.model_copy(
        update={
            "placement": placement.model_copy(
                update={"lattice": lattice.model_copy(update={"drop_fraction": frac})}
            )
        }
    )
    return base.model_copy(update={"layers": updated_layers})


def _is_lattice_layer(layer) -> bool:
    placement = getattr(layer, "placement", None)
    return (
        layer.type == "motif"
        and placement is not None
        and placement.type == "lattice"
        and placement.lattice is not None
    )
