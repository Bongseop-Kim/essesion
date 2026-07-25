"""Deterministic, catalog-only preparation for authoring example previews."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from worker.authoring.compiler import AuthoredDesign, PlanCompileError, compile_design_plan_v3
from worker.authoring.schema import DesignPlanV3
from worker.motifs.registry import MotifCatalog
from worker.motifs.store import get_motifs


@dataclass(frozen=True)
class PreparedAuthoringPreview:
    design: AuthoredDesign
    motifs: MotifCatalog
    warnings: list[str]


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

    requested_ids: dict[int, str] = {}
    warnings: list[str] = []
    for index, source in enumerate(plan.motifs):
        if source.source == "input":
            if source.input_index <= len(motif_ids):
                requested_ids[index] = motif_ids[source.input_index - 1]
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
        plan_index=0,
        motif_ids=resolved_ids,
        tile_mm=tile_mm,
        seed=seed,
    )
    return PreparedAuthoringPreview(design=design, motifs=motifs, warnings=warnings)
