"""Starter authoring example seeding and RAG selection tests."""

from __future__ import annotations

import pytest
from db.models.seamless import AuthoringExample
from sqlalchemy import select
from worker.adapters import AdapterClientError
from worker.authoring import store
from worker.authoring.examples import load_example_set
from worker.authoring.retrieval import retrieve_examples

DIM = 1536
MODEL = "test-embedding-1536"


def _vec(*head: float) -> list[float]:
    return list(head) + [0.0] * (DIM - len(head))


async def _project(db_session, indexes: tuple[int, ...]) -> None:  # noqa: ANN001
    examples = load_example_set()
    for index in indexes:
        example = examples[index]
        assert await store.project_manifest(
            db_session,
            example,
            embedding_model=MODEL,
        )
        assert await store.update_embedding_if_missing(
            db_session,
            example_id=example.example_id,
            embedding_model=MODEL,
            embedding=_vec(1.0),
        )
    await db_session.commit()


async def test_projection_is_insert_only_when_starter_content_changes(db_session):
    example = load_example_set()[0]
    assert await store.project_manifest(
        db_session,
        example,
        embedding_model=MODEL,
    )
    assert not await store.project_manifest(
        db_session,
        example,
        embedding_model=MODEL,
    )

    changed = example.model_copy(update={"retrieval_text": example.retrieval_text + " changed"})
    assert not await store.project_manifest(
        db_session,
        changed,
        embedding_model=MODEL,
    )
    await db_session.commit()
    existing = await db_session.scalar(
        select(AuthoringExample).where(AuthoringExample.example_id == example.example_id)
    )
    assert existing is not None
    assert existing.retrieval_text == example.retrieval_text


async def test_first_embedding_activates_bootstrap_without_overriding_later_admin_choice(
    db_session,
):
    example = load_example_set()[0]
    await store.project_manifest(db_session, example, embedding_model=MODEL)
    assert await store.update_embedding_if_missing(
        db_session,
        example_id=example.example_id,
        embedding_model=MODEL,
        embedding=_vec(1.0),
    )
    await db_session.commit()

    row = await db_session.scalar(
        select(AuthoringExample).where(AuthoringExample.example_id == example.example_id)
    )
    assert row is not None
    assert row.active is True
    assert row.approved_at is not None
    assert row.active_updated_at is not None
    assert row.active_reason == "bootstrap seed"

    row.active = False
    row.embedding_openai = None
    row.active_reason = "admin disabled"
    await db_session.commit()
    assert await store.update_embedding_if_missing(
        db_session,
        example_id=example.example_id,
        embedding_model=MODEL,
        embedding=_vec(0.5),
    )
    await db_session.refresh(row)
    assert row.active is False
    assert row.active_reason == "admin disabled"


async def test_projection_preserves_database_curated_content(db_session):
    example = load_example_set()[0]
    await store.project_manifest(
        db_session,
        example,
        embedding_model=MODEL,
    )
    await db_session.commit()

    existing = await db_session.scalar(
        select(AuthoringExample).where(AuthoringExample.example_id == example.example_id)
    )
    assert existing is not None
    existing.retrieval_text = f"{existing.retrieval_text} tampered"
    await db_session.commit()

    assert not await store.project_manifest(
        db_session,
        example,
        embedding_model=MODEL,
    )
    await db_session.refresh(existing)
    assert existing.retrieval_text.endswith("tampered")


async def test_projection_rolls_curated_bootstrap_row_to_current_embedding_model(
    db_session,
):
    example = load_example_set()[0]
    old_model = "retired-embedding-1536"
    await store.project_manifest(db_session, example, embedding_model=old_model)
    await store.update_embedding_if_missing(
        db_session,
        example_id=example.example_id,
        embedding_model=old_model,
        embedding=_vec(0.5),
    )
    row = await db_session.scalar(
        select(AuthoringExample).where(AuthoringExample.example_id == example.example_id)
    )
    assert row is not None
    row.retrieval_text = f"{row.retrieval_text} curated"
    await db_session.commit()

    assert not await store.project_manifest(db_session, example, embedding_model=MODEL)
    assert await store.missing_embedding_ids(
        db_session,
        embedding_model=MODEL,
    ) == {example.example_id}
    assert await store.update_embedding_if_missing(
        db_session,
        example_id=example.example_id,
        embedding_model=MODEL,
        embedding=_vec(1.0),
    )
    await db_session.commit()
    await db_session.refresh(row)

    assert row.embedding_model == MODEL
    assert row.retrieval_text.endswith("curated")
    assert row.active is True
    matches = await store.nearest_examples(
        db_session,
        _vec(1.0),
        embedding_model=MODEL,
    )
    assert [match.example_id for match in matches] == [example.example_id]


async def test_nearest_examples_are_stable_and_exclude_missing_embeddings(db_session):
    await _project(db_session, (0, 1))
    missing = load_example_set()[5]
    await store.project_manifest(
        db_session,
        missing,
        embedding_model=MODEL,
    )
    await db_session.commit()

    matches = await store.nearest_examples(
        db_session,
        _vec(1.0),
        embedding_model=MODEL,
    )
    assert [match.example_id for match in matches] == sorted(
        [load_example_set()[0].example_id, load_example_set()[1].example_id]
    )
    assert all(match.similarity == pytest.approx(1.0) for match in matches)
    assert await store.embedding_counts(
        db_session,
        embedding_model=MODEL,
    ) == (2, 3)


async def test_retrieval_selects_up_to_three_compatible_unique_families(db_session):
    await _project(db_session, (0, 1, 5, 6))

    class _Embedding:
        model = MODEL

        async def embed(self, text: str) -> list[float]:
            return _vec(1.0)

    outcome = await retrieve_examples(
        db_session,
        "차분한 모티프와 스트라이프 패턴",
        embedding_client=_Embedding(),
        embedding_model=MODEL,
        available_motif_count=2,
    )

    assert outcome.status == "ok"
    assert [example.family for example in outcome.examples] == ["solid", "stripe", "lattice"]
    assert len(outcome.prompt_examples()) == 3
    assert [item["rank"] for item in outcome.diagnostics()] == [1, 2, 3]


async def test_retrieval_keeps_same_family_subtypes_instead_of_one_per_family(db_session):
    # 같은 패밀리 안에서 subtype만 다른 예시(좁은/폭 다른 스트라이프)를 유사도 순으로 함께
    # 넘겨야 한다 — 패밀리별 1건 제한은 정답 예시를 버렸다.
    await _project(db_session, (1, 2, 5))

    class _Embedding:
        model = MODEL

        async def embed(self, text: str) -> list[float]:
            return _vec(1.0)

    outcome = await retrieve_examples(
        db_session,
        "stripe and lattice",
        embedding_client=_Embedding(),
        embedding_model=MODEL,
        available_motif_count=2,
    )

    assert outcome.status == "ok"
    assert [example.family for example in outcome.examples] == ["stripe", "stripe", "lattice"]


async def test_retrieval_fails_soft_when_embedding_provider_fails(db_session):
    class _BrokenEmbedding:
        model = MODEL

        async def embed(self, text: str) -> list[float]:
            raise AdapterClientError(
                "unavailable",
                provider="openai_embedding",
                operation="embed",
                reason_code="provider_5xx",
            )

    outcome = await retrieve_examples(
        db_session,
        "pattern",
        embedding_client=_BrokenEmbedding(),
        embedding_model=MODEL,
        available_motif_count=0,
    )
    assert outcome.status == "embedding_error"
    assert outcome.reason == "provider_5xx"
