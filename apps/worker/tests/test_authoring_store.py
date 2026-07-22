"""Immutable authoring example projection and RAG selection tests."""

from __future__ import annotations

import pytest
from db.models.seamless import AuthoringExample
from worker.adapters import AdapterClientError
from worker.authoring import store
from worker.authoring.examples import load_example_set
from worker.authoring.retrieval import retrieve_examples
from worker.engine.constraints import PatternConstraints

DIM = 3072
MODEL = "test-embedding-3072"
REVISION = "gallery-test-v1"


def _vec(*head: float) -> list[float]:
    return list(head) + [0.0] * (DIM - len(head))


async def _project(db_session, indexes: tuple[int, ...]) -> None:  # noqa: ANN001
    examples = load_example_set()
    for index in indexes:
        example = examples[index]
        assert await store.project_manifest(
            db_session,
            example,
            example_set_revision=REVISION,
            embedding_model=MODEL,
        )
        assert await store.update_embedding_if_missing(
            db_session,
            example_set_revision=REVISION,
            example_id=example.example_id,
            embedding_model=MODEL,
            embedding=_vec(1.0),
        )
    await db_session.commit()


async def test_projection_is_idempotent_and_rejects_content_drift(db_session):
    example = load_example_set()[0]
    assert await store.project_manifest(
        db_session,
        example,
        example_set_revision=REVISION,
        embedding_model=MODEL,
    )
    assert not await store.project_manifest(
        db_session,
        example,
        example_set_revision=REVISION,
        embedding_model=MODEL,
    )

    changed = example.model_copy(update={"retrieval_text": example.retrieval_text + " changed"})
    with pytest.raises(ValueError, match="immutable authoring example changed"):
        await store.project_manifest(
            db_session,
            changed,
            example_set_revision=REVISION,
            embedding_model=MODEL,
        )


async def test_projection_rejects_database_drift(db_session):
    example = load_example_set()[0]
    await store.project_manifest(
        db_session,
        example,
        example_set_revision=REVISION,
        embedding_model=MODEL,
    )
    await db_session.commit()

    existing = await db_session.get(AuthoringExample, (REVISION, example.example_id))
    assert existing is not None
    existing.retrieval_text = f"{existing.retrieval_text} tampered"
    await db_session.commit()

    with pytest.raises(ValueError, match="immutable authoring example changed"):
        await store.project_manifest(
            db_session,
            example,
            example_set_revision=REVISION,
            embedding_model=MODEL,
        )


async def test_nearest_examples_are_stable_and_exclude_missing_embeddings(db_session):
    await _project(db_session, (0, 1))
    missing = load_example_set()[5]
    await store.project_manifest(
        db_session,
        missing,
        example_set_revision=REVISION,
        embedding_model=MODEL,
    )
    await db_session.commit()

    matches = await store.nearest_examples(
        db_session,
        _vec(1.0),
        example_set_revision=REVISION,
        embedding_model=MODEL,
    )
    assert [match.example_id for match in matches] == sorted(
        [load_example_set()[0].example_id, load_example_set()[1].example_id]
    )
    assert all(match.similarity == pytest.approx(1.0) for match in matches)
    assert await store.embedding_counts(
        db_session,
        example_set_revision=REVISION,
        embedding_model=MODEL,
    ) == (2, 3)


async def test_retrieval_selects_up_to_three_compatible_unique_families(db_session):
    await _project(db_session, (0, 1, 5, 6))

    class _Embedding:
        model = MODEL

        async def embed(self, text: str, *, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
            assert "available motif slots: 2" in text
            assert task_type == "RETRIEVAL_QUERY"
            return _vec(1.0)

    outcome = await retrieve_examples(
        db_session,
        "차분한 모티프와 스트라이프 패턴",
        embedding_client=_Embedding(),
        embedding_model=MODEL,
        available_motif_count=2,
        pattern_constraints=PatternConstraints(),
        example_set_revision=REVISION,
    )

    assert outcome.status == "ok"
    assert [example.family for example in outcome.examples] == ["solid", "stripe", "lattice"]
    assert len(outcome.prompt_examples()) == 3
    assert [item["rank"] for item in outcome.diagnostics()] == [1, 2, 3]


async def test_retrieval_fails_soft_when_embedding_provider_fails(db_session):
    class _BrokenEmbedding:
        model = MODEL

        async def embed(self, text: str, *, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
            raise AdapterClientError(
                "unavailable",
                provider="vertex_embedding",
                operation="embed",
                reason_code="provider_5xx",
            )

    outcome = await retrieve_examples(
        db_session,
        "pattern",
        embedding_client=_BrokenEmbedding(),
        embedding_model=MODEL,
        available_motif_count=0,
        pattern_constraints=PatternConstraints(),
        example_set_revision=REVISION,
    )
    assert outcome.status == "embedding_error"
    assert outcome.reason == "provider_5xx"
