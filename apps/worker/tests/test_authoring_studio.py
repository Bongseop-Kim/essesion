"""Catalog-only preview and authored-example metadata/embedding worker contracts."""

from __future__ import annotations

from db.models.seamless import EMBEDDING_DIM, Motif
from worker.adapters import AdapterClientError


def _solid_plan() -> dict:
    return {
        "colors": ["#F4EFE6", "#213547"],
        "ground_color_index": 0,
        "motifs": [],
        "layers": [],
    }


def _motif_plan() -> dict:
    return {
        "colors": ["#F4EFE6", "#213547"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.18,
                "color_indices": [1],
                "placement": {
                    "type": "lattice",
                    "columns": 4,
                    "rows": 4,
                    "drop": "none",
                    "fixed_rotation_deg": 0,
                },
            }
        ],
    }


async def test_compile_preview_uses_catalog_without_generation_adapters(
    app,
    client,
):
    async with app.state.sessionmaker() as session:
        session.add(
            Motif(
                id="studio-flower",
                symbol=(
                    '<symbol id="motif-studio-flower" overflow="visible">'
                    '<circle cx="0" cy="0" r="0.45" fill="currentColor"/>'
                    "</symbol>"
                ),
                bbox=[-0.5, -0.5, 0.5, 0.5],
                anchor=[0.0, 0.0],
                subject="flower",
            )
        )
        await session.commit()
    response = await client.post(
        "/authoring/compile-preview",
        json={"plan": _motif_plan(), "motif_ids": ["studio-flower"], "seed": 17},
    )

    assert response.status_code == 200, response.text
    assert response.json()["svg"].startswith("<svg")
    assert response.json()["warnings"] == []
    assert app.state.adapters.gemini is None
    assert app.state.adapters.recraft is None


async def test_compile_preview_drops_missing_catalog_motif_with_warning(client):
    response = await client.post(
        "/authoring/compile-preview",
        json={"plan": _motif_plan(), "motif_ids": ["missing-motif"]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["svg"].startswith("<svg")
    assert response.json()["warnings"] == [
        "catalog motif missing-motif was not found and its layers were omitted"
    ]


async def test_compile_preview_rejects_invalid_plan_and_input_mapping(client):
    invalid = await client.post(
        "/authoring/compile-preview",
        json={"plan": {**_solid_plan(), "colors": ["#000000"]}},
    )
    assert invalid.status_code == 422

    unmatched = await client.post(
        "/authoring/compile-preview",
        json={"plan": _solid_plan(), "motif_ids": ["unused"]},
    )
    assert unmatched.status_code == 422
    assert "referenced exactly once" in unmatched.text

    duplicated_source = {
        **_motif_plan(),
        "motifs": [
            {"source": "input", "input_index": 1},
            {"source": "input", "input_index": 1},
        ],
        "layers": [
            _motif_plan()["layers"][0],
            {**_motif_plan()["layers"][0], "motif_index": 1},
        ],
    }
    duplicated = await client.post(
        "/authoring/compile-preview",
        json={"plan": duplicated_source, "motif_ids": ["studio-flower"]},
    )
    assert duplicated.status_code == 422
    assert "referenced exactly once" in duplicated.text


async def test_prepare_derives_metadata_and_embedding_once_at_authoring(app, client):
    class _Embedding:
        model = "studio-embedding"

        def __init__(self) -> None:
            self.calls: list[tuple[str, str]] = []

        async def embed(self, text: str, *, task_type: str) -> list[float]:
            self.calls.append((text, task_type))
            return [1.0] + [0.0] * (EMBEDDING_DIM - 1)

    embedding = _Embedding()
    app.state.adapters.embedding = embedding
    response = await client.post(
        "/authoring/examples/prepare",
        json={
            "retrieval_text": "  차분한 단색 넥타이 패턴  ",
            "plan": _solid_plan(),
        },
    )
    assert response.status_code == 200, response.text
    prepared = response.json()
    assert prepared["family"] == "solid"
    assert prepared["tags"] == ["solid"]
    assert prepared["retrieval_text"] == "차분한 단색 넥타이 패턴"
    assert prepared["motif_count"] == 0
    assert prepared["embedding_model"] == embedding.model
    assert len(prepared["embedding"]) == EMBEDDING_DIM
    assert embedding.calls == [("차분한 단색 넥타이 패턴, solid, solid", "RETRIEVAL_DOCUMENT")]
    current_model = await client.post(
        "/authoring/examples/embedding-model",
        json={},
    )
    assert current_model.status_code == 200
    assert current_model.json() == {"model": embedding.model}
    assert len(embedding.calls) == 1


async def test_prepare_rejects_retrieval_text_that_is_too_short_after_stripping(client):
    response = await client.post(
        "/authoring/examples/prepare",
        json={
            "retrieval_text": "          짧음          ",
            "plan": _solid_plan(),
        },
    )
    assert response.status_code == 422


async def test_prepare_maps_embedding_adapter_errors_to_bad_gateway(app, client):
    class _Embedding:
        model = "studio-embedding"

        async def embed(self, text: str, *, task_type: str) -> list[float]:
            raise AdapterClientError(
                "unavailable",
                provider="vertex_embedding",
                operation="embed",
                reason_code="provider_5xx",
            )

    app.state.adapters.embedding = _Embedding()
    response = await client.post(
        "/authoring/examples/prepare",
        json={
            "retrieval_text": "임베딩 공급자 오류를 확인하는 단색 패턴",
            "plan": _solid_plan(),
        },
    )
    assert response.status_code == 502


async def test_prepare_maps_wrong_embedding_dimension_to_bad_gateway(app, client):
    class _Embedding:
        model = "studio-embedding"

        async def embed(self, text: str, *, task_type: str) -> list[float]:
            return [1.0]

    app.state.adapters.embedding = _Embedding()
    response = await client.post(
        "/authoring/examples/prepare",
        json={
            "retrieval_text": "잘못된 임베딩 차원을 확인하는 단색 패턴",
            "plan": _solid_plan(),
        },
    )
    assert response.status_code == 502


async def test_embedding_is_unavailable_without_provider(client):
    response = await client.post(
        "/authoring/examples/prepare",
        json={
            "retrieval_text": "임베딩 공급자가 없는 단색 패턴",
            "plan": _solid_plan(),
        },
    )
    assert response.status_code == 503
    current_model = await client.post(
        "/authoring/examples/embedding-model",
        json={},
    )
    assert current_model.status_code == 503
