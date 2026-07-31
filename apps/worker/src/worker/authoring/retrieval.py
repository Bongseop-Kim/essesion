"""Fail-soft, deterministic RAG selection for trusted Plan v3 examples."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from worker.adapters import AdapterClientError
from worker.adapters.embedding import SupportsEmbed, embed_query
from worker.authoring import store
from worker.authoring.schema import DesignPlanV3


@dataclass(frozen=True)
class RetrievalOutcome:
    status: str
    examples: tuple[store.ExampleMatch, ...] = ()
    reason: str | None = None

    def prompt_examples(self) -> list[dict[str, object]]:
        return [
            {
                "example_id": example.example_id,
                "family": example.family,
                "retrieval_text": example.retrieval_text,
                "plan": example.plan,
            }
            for example in self.examples
        ]

    def diagnostics(self) -> list[dict[str, object]]:
        return [
            {
                "example_id": example.example_id,
                "family": example.family,
                "similarity": round(example.similarity, 6),
                "rank": rank,
            }
            for rank, example in enumerate(self.examples, start=1)
        ]


def retrieval_query_document(prompt: str, *, available_motif_count: int) -> str:
    lines = [prompt.strip(), f"available motif slots: {available_motif_count}"]
    return "\n".join(line for line in lines if line)


def _compatible(match: store.ExampleMatch, *, available_motif_count: int) -> bool:
    try:
        plan = DesignPlanV3.model_validate(match.plan)
    except ValueError:
        return False
    return len(plan.motifs) <= available_motif_count


async def retrieve_examples(
    session: AsyncSession,
    prompt: str,
    *,
    embedding_client: SupportsEmbed | None,
    embedding_model: str,
    available_motif_count: int,
) -> RetrievalOutcome:
    if embedding_client is None:
        return RetrievalOutcome(status="embedding_unavailable")
    query = retrieval_query_document(prompt, available_motif_count=available_motif_count)
    try:
        embedding = await embed_query(query, client=embedding_client)
        if embedding is None:
            return RetrievalOutcome(status="embedding_unavailable")
        matches = await store.nearest_examples(
            session,
            embedding,
            embedding_model=embedding_model,
        )
    except AdapterClientError as exc:
        return RetrievalOutcome(status="embedding_error", reason=exc.reason_code)
    except Exception as exc:
        return RetrievalOutcome(status="retrieval_error", reason=exc.__class__.__name__)

    compatible = [
        match
        for match in matches
        if _compatible(match, available_motif_count=available_motif_count)
    ][:8]
    if not compatible:
        return RetrievalOutcome(status="index_empty")

    selected: list[store.ExampleMatch] = []
    selected_families: set[str] = set()
    for match in compatible:
        if match.family in selected_families:
            continue
        selected.append(match)
        selected_families.add(match.family)
        if len(selected) == 3:
            break
    return RetrievalOutcome(status="ok", examples=tuple(selected))
