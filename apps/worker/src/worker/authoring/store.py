"""Bootstrap projection and active authoring-example retrieval queries."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from db.models.seamless import AuthoringExample
from sqlalchemy import CursorResult, case, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from worker.authoring.compiler import PLAN_CONTRACT_VERSION
from worker.authoring.examples import AuthoringExampleManifest
from worker.authoring.schema import structural_fingerprint


@dataclass(frozen=True)
class ExampleMatch:
    example_id: str
    family: str
    retrieval_text: str
    plan: dict
    similarity: float


async def project_manifest(
    session: AsyncSession,
    manifest: AuthoringExampleManifest,
    *,
    embedding_model: str,
) -> bool:
    """Insert one immutable bootstrap example without overriding admin activation."""

    motif_count = len(manifest.plan.motifs)
    plan = manifest.plan.model_dump(mode="json")
    source_digest = manifest.source_digest()
    values = {
        "example_id": manifest.example_id,
        "source": "bootstrap",
        "contract_version": PLAN_CONTRACT_VERSION,
        "family": manifest.family,
        "motif_count": motif_count,
        "retrieval_text": manifest.retrieval_text,
        "tags": manifest.tags,
        "plan": plan,
        "structural_fingerprint": structural_fingerprint(manifest.plan),
        "source_digest": source_digest,
        "embedding_model": embedding_model,
    }
    inserted = await session.scalar(
        pg_insert(AuthoringExample)
        .values(**values)
        .on_conflict_do_nothing(index_elements=[AuthoringExample.example_id])
        .returning(AuthoringExample.example_id)
    )
    if inserted is not None:
        return True

    existing = await session.scalar(
        select(AuthoringExample).where(AuthoringExample.example_id == manifest.example_id)
    )
    if existing is None or any(
        (
            existing.source_digest != source_digest,
            existing.contract_version != PLAN_CONTRACT_VERSION,
            existing.family != manifest.family,
            existing.motif_count != motif_count,
            existing.retrieval_text != manifest.retrieval_text,
            existing.tags != manifest.tags,
            existing.plan != plan,
            existing.structural_fingerprint != values["structural_fingerprint"],
            existing.embedding_model != embedding_model,
            existing.source != "bootstrap",
        )
    ):
        raise ValueError(f"immutable bootstrap authoring example changed: {manifest.example_id}")
    return False


async def update_embedding_if_missing(
    session: AsyncSession,
    *,
    example_id: str,
    embedding_model: str,
    embedding: list[float],
) -> bool:
    result = await session.execute(
        update(AuthoringExample)
        .where(
            AuthoringExample.example_id == example_id,
            AuthoringExample.embedding_model == embedding_model,
            AuthoringExample.embedding_vertex.is_(None),
        )
        .values(
            embedding_vertex=embedding,
            approved_at=func.coalesce(AuthoringExample.approved_at, func.now()),
            active=case(
                (AuthoringExample.active_updated_at.is_(None), True),
                else_=AuthoringExample.active,
            ),
            active_updated_at=func.coalesce(AuthoringExample.active_updated_at, func.now()),
            active_reason=case(
                (AuthoringExample.active_updated_at.is_(None), "bootstrap sync"),
                else_=AuthoringExample.active_reason,
            ),
        )
    )
    return bool(cast(CursorResult, result).rowcount)


async def missing_embedding_ids(
    session: AsyncSession,
    *,
    embedding_model: str,
) -> set[str]:
    rows = await session.scalars(
        select(AuthoringExample.example_id).where(
            AuthoringExample.source == "bootstrap",
            AuthoringExample.embedding_model == embedding_model,
            AuthoringExample.embedding_vertex.is_(None),
        )
    )
    return set(rows)


async def embedding_counts(
    session: AsyncSession,
    *,
    embedding_model: str,
) -> tuple[int, int]:
    row = (
        await session.execute(
            select(
                func.count().filter(AuthoringExample.embedding_vertex.is_not(None)),
                func.count(),
            ).where(
                AuthoringExample.source == "bootstrap",
                AuthoringExample.embedding_model == embedding_model,
            )
        )
    ).one()
    return int(row[0]), int(row[1])


async def nearest_examples(
    session: AsyncSession,
    embedding: list[float],
    *,
    embedding_model: str,
    limit: int = 25,
) -> list[ExampleMatch]:
    distance = AuthoringExample.embedding_vertex.cosine_distance(embedding)
    rows = (
        await session.execute(
            select(
                AuthoringExample.example_id,
                AuthoringExample.family,
                AuthoringExample.retrieval_text,
                AuthoringExample.plan,
                distance.label("distance"),
            )
            .where(
                AuthoringExample.active.is_(True),
                AuthoringExample.contract_version == PLAN_CONTRACT_VERSION,
                AuthoringExample.embedding_model == embedding_model,
                AuthoringExample.embedding_vertex.is_not(None),
            )
            .order_by(distance.asc(), AuthoringExample.example_id.asc())
            .limit(limit)
        )
    ).all()
    return [
        ExampleMatch(
            example_id=row[0],
            family=row[1],
            retrieval_text=row[2],
            plan=row[3],
            similarity=1.0 - float(row[4]),
        )
        for row in rows
    ]
