"""Deterministic, catalog-only preparation for authoring example previews."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from worker.authoring.compiler import AuthoredDesign, PlanCompileError, compile_design_plan_v3
from worker.authoring.schema import DesignPlanV3
from worker.motifs.registry import MotifCatalog
from worker.motifs.store import find_catalog, get_motifs


@dataclass(frozen=True)
class PreparedAuthoringPreview:
    design: AuthoredDesign
    motifs: MotifCatalog
    warnings: list[str]


def _required_recolor_slot_counts(plan: DesignPlanV3) -> dict[int, set[int]]:
    required: dict[int, set[int]] = {}
    for layer in plan.layers:
        if layer.type != "motif" or layer.color_indices is None:
            continue
        required.setdefault(layer.motif_index, set()).add(len(layer.color_indices))
    return required


async def prepare_authoring_preview(
    session: AsyncSession,
    plan: DesignPlanV3,
    *,
    motif_ids: list[str],
    tile_mm: float,
    seed: int | None,
) -> PreparedAuthoringPreview:
    """Resolve only existing catalog motifs, dropping unresolved motif layers with warnings."""

    input_indexes = [source.input_index for source in plan.motifs if source.source == "input"]
    expected_indexes = list(range(1, len(motif_ids) + 1))
    if motif_ids and sorted(input_indexes) != expected_indexes:
        raise PlanCompileError(
            "every selected motif must be referenced exactly once by input_index"
        )
    if motif_ids and any(source.source != "input" for source in plan.motifs):
        raise PlanCompileError("selected motif IDs cannot be combined with other motif sources")

    # 시드 예시처럼 motif_ids 없이 input 모티프를 참조하는 플랜은 카탈로그
    # 자리 표시 모티프로 치환해 레이아웃이 보이게 한다 (ORDER BY id — 결정적).
    needs_placeholder = any(
        source.source == "input" and source.input_index > len(motif_ids) for source in plan.motifs
    )
    placeholder_catalog = await find_catalog(session) if needs_placeholder else []
    required_slot_counts = _required_recolor_slot_counts(plan)
    used_placeholder_ids = {
        source.catalog_ref for source in plan.motifs if source.source == "catalog"
    } | set(motif_ids)
    placeholder_ids: dict[int, str] = {}
    placeholder_indexes = sorted(
        (
            index
            for index, source in enumerate(plan.motifs)
            if source.source == "input" and source.input_index > len(motif_ids)
        ),
        key=lambda index: (len(required_slot_counts.get(index, set())) != 1, index),
    )
    for index in placeholder_indexes:
        counts = required_slot_counts.get(index, set())
        if len(counts) > 1:
            continue
        required_count = next(iter(counts)) if counts else None
        placeholder = next(
            (
                motif
                for motif in placeholder_catalog
                if motif.id not in used_placeholder_ids
                and (required_count is None or len(motif.color_slots) == required_count)
            ),
            None,
        )
        if placeholder is not None:
            used_placeholder_ids.add(placeholder.id)
            placeholder_ids[index] = placeholder.id

    requested_ids: dict[int, str] = {}
    warnings: list[str] = []
    for index, source in enumerate(plan.motifs):
        if source.source == "input":
            if source.input_index <= len(motif_ids):
                requested_ids[index] = motif_ids[source.input_index - 1]
            elif placeholder_catalog:
                placeholder_id = placeholder_ids.get(index)
                if placeholder_id is None:
                    counts = sorted(required_slot_counts.get(index, set()))
                    suffix = (
                        f" with {counts[0]} color slots"
                        if len(counts) == 1
                        else " with a compatible color slot count"
                    )
                    warnings.append(
                        f"motif input {source.input_index} was not selected and no compatible"
                        f" placeholder catalog motif{suffix} was found; its layers were omitted"
                    )
                    continue
                requested_ids[index] = placeholder_id
                warnings.append(
                    f"motif input {source.input_index} was not selected;"
                    " a placeholder catalog motif is shown"
                )
            else:
                warnings.append(
                    f"motif input {source.input_index} was not selected and its layers were omitted"
                )
        elif source.source == "catalog":
            requested_ids[index] = source.catalog_ref
        else:
            warnings.append(
                f"{source.source} motif {index + 1} requires generation and its layers were omitted"
            )

    motifs = await get_motifs(session, requested_ids.values())
    resolved_indexes: dict[int, int] = {}
    resolved_ids: list[str] = []
    for original_index, motif_id in requested_ids.items():
        if motif_id not in motifs:
            warnings.append(f"catalog motif {motif_id} was not found and its layers were omitted")
            continue
        resolved_indexes[original_index] = len(resolved_ids)
        resolved_ids.append(motif_id)

    raw = plan.model_dump(mode="json")
    raw["motifs"] = [
        {"source": "input", "input_index": index + 1} for index in range(len(resolved_ids))
    ]
    layers: list[dict[str, object]] = []
    for layer in raw["layers"]:
        if layer["type"] != "motif":
            layers.append(layer)
            continue
        original_index = layer["motif_index"]
        resolved_index = resolved_indexes.get(original_index)
        if resolved_index is None:
            continue
        layer["motif_index"] = resolved_index
        layers.append(layer)
    raw["layers"] = layers
    preview_plan = DesignPlanV3.model_validate(raw)
    design = compile_design_plan_v3(
        preview_plan,
        motif_ids=resolved_ids,
        tile_mm=tile_mm,
        seed=seed,
    )
    return PreparedAuthoringPreview(design=design, motifs=motifs, warnings=warnings)
