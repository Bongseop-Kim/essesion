"""Catalog-only preview and authored-example metadata/embedding worker contracts."""

from __future__ import annotations

import re

from db.models.seamless import EMBEDDING_DIM, Motif
from sqlalchemy import delete
from worker.adapters import AdapterClientError


def _solid_plan() -> dict:
    return {
        "colors": ["#F4EFE6", "#213547"],
        "ground_color_index": 0,
        "motifs": [],
        "layers": [],
    }


def _motif_layer(*, motif_index: int = 0) -> dict:
    return {
        "type": "motif",
        "motif_index": motif_index,
        "size_ratio": 0.18,
        "placement": {
            "type": "lattice",
            "columns": 4,
            "rows": 4,
            "drop": "none",
            "fixed_rotation_deg": 0,
        },
    }


def _motif_plan() -> dict:
    return {
        "colors": ["#F4EFE6", "#213547"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [_motif_layer()],
    }


def _stripe_motif_plan(size_ratio: float) -> dict:
    return {
        "colors": ["#102A43", "#747965", "#D1A13A"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.70710677,
                "bands": [
                    {
                        "offset_ratio": 0.3,
                        "width_ratio": 0.1,
                        "color_index": 1,
                    }
                ],
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": size_ratio,
                "placement": {
                    "type": "path",
                    "kind": "straight",
                    "direction": "diagonal_up",
                    "spacing_ratio": 0.25,
                    "phase_ratio": 0,
                    "rotation": "follow_path",
                },
            },
        ],
    }


def _motif(motif_id: str, color: str = "#213547") -> Motif:
    return Motif(
        id=motif_id,
        symbol=(
            f'<symbol id="motif-{motif_id}" overflow="visible">'
            f'<circle cx="0" cy="0" r="0.1" fill="{color}"/>'
            "</symbol>"
        ),
        bbox=[-0.5, -0.5, 0.5, 0.5],
        anchor=[0.0, 0.0],
        subject="preview motif",
        status="approved",
    )


async def test_compile_preview_uses_catalog_without_generation_adapters(
    app,
    client,
):
    async with app.state.sessionmaker() as session:
        session.add(_motif("studio-flower"))
        await session.commit()
    response = await client.post(
        "/authoring/compile-preview",
        json={"plan": _motif_plan(), "motif_ids": ["studio-flower"], "seed": 17},
    )

    assert response.status_code == 200, response.text
    assert response.json()["svg"].startswith("<svg")
    assert response.json()["warnings"] == []
    assert app.state.adapters.llm is None
    assert app.state.adapters.recraft is None


async def test_compile_preview_renders_requested_plan_without_layout_variants(app, client):
    motif_id = "studio-preview-identity"
    async with app.state.sessionmaker() as session:
        session.add(_motif(motif_id))
        await session.commit()

    expected_scales = {
        0.29166667: "14",
        0.3: "14.4",
        0.31: "14.88",
        0.311: "14.928",
        0.3112: "14.9376",
    }
    expected_anchors = {("0", "0"), ("12", "36"), ("24", "24"), ("36", "12")}

    for size_ratio, expected_scale in expected_scales.items():
        response = await client.post(
            "/authoring/compile-preview",
            json={
                "plan": _stripe_motif_plan(size_ratio),
                "motif_ids": [motif_id],
                "seed": 17,
            },
        )

        assert response.status_code == 200, response.text
        svg = response.json()["svg"]
        transforms = re.findall(
            r'<use [^>]*transform="translate\(([^)]+)\) rotate\([^)]+\) '
            r'scale\(([^)]+)\)"',
            svg,
        )
        assert {scale for _translate, scale in transforms} == {expected_scale}
        anchors = {
            tuple(translate.split())
            for translate, _scale in transforms
            if all(0 <= float(value) < 48 for value in translate.split())
        }
        assert anchors == expected_anchors
        assert set(
            re.findall(
                r'<line [^>]*stroke="#747965" stroke-width="([^"]+)"',
                svg,
            )
        ) == {"3.3941"}


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


async def test_compile_preview_substitutes_placeholder_for_unselected_input(app, client):
    async with app.state.sessionmaker() as session:
        session.add(_motif("studio-placeholder"))
        await session.commit()
    response = await client.post(
        "/authoring/compile-preview",
        json={"plan": _motif_plan(), "motif_ids": [], "seed": 17},
    )

    assert response.status_code == 200, response.text
    assert "motif-studio-placeholder" in response.json()["svg"]
    assert response.json()["warnings"] == [
        "motif input 1 was not selected; a placeholder catalog motif is shown"
    ]


async def test_compile_preview_allocates_unique_placeholders_in_catalog_order(app, client):
    one_input_plan = {
        "colors": ["#F4EFE6", "#111111", "#222222", "#333333", "#444444", "#555555", "#666666"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [_motif_layer()],
    }
    async with app.state.sessionmaker() as session:
        session.add_all([_motif("bbb-first"), _motif("zzz-second")])
        await session.commit()
    response = await client.post(
        "/authoring/compile-preview",
        json={"plan": one_input_plan, "motif_ids": [], "seed": 17},
    )

    assert response.status_code == 200, response.text
    assert "motif-bbb-first" in response.json()["svg"]
    assert "motif-zzz-second" not in response.json()["svg"]
    assert response.json()["warnings"] == [
        "motif input 1 was not selected; a placeholder catalog motif is shown"
    ]

    two_input_plan = {
        "colors": ["#F4EFE6", "#111111", "#222222", "#333333", "#444444", "#555555", "#666666"],
        "ground_color_index": 0,
        "motifs": [
            {"source": "input", "input_index": 1},
            {"source": "input", "input_index": 2},
        ],
        "layers": [
            _motif_layer(motif_index=0),
            _motif_layer(motif_index=1),
        ],
    }
    async with app.state.sessionmaker() as session:
        await session.execute(delete(Motif).where(Motif.id.in_(("aaa-first", "bbb-second"))))
        await session.execute(delete(Motif))
        session.add_all([_motif("aaa-first"), _motif("bbb-second")])
        await session.commit()
    ordered = await client.post(
        "/authoring/compile-preview",
        json={"plan": two_input_plan, "motif_ids": [], "seed": 17},
    )

    assert ordered.status_code == 200, ordered.text
    assert "motif-aaa-first" in ordered.json()["svg"]
    assert "motif-bbb-second" in ordered.json()["svg"]
    assert ordered.json()["warnings"] == [
        "motif input 1 was not selected; a placeholder catalog motif is shown",
        "motif input 2 was not selected; a placeholder catalog motif is shown",
    ]


async def test_compile_preview_omits_input_layers_when_catalog_is_empty(client):
    response = await client.post(
        "/authoring/compile-preview",
        json={"plan": _motif_plan(), "motif_ids": []},
    )

    assert response.status_code == 200, response.text
    assert response.json()["warnings"] == [
        "motif input 1 was not selected and its layers were omitted"
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
            self.calls: list[str] = []

        async def embed(self, text: str) -> list[float]:
            self.calls.append(text)
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
    assert embedding.calls == ["차분한 단색 넥타이 패턴, solid, solid"]
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

        async def embed(self, text: str) -> list[float]:
            raise AdapterClientError(
                "unavailable",
                provider="openai_embedding",
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

        async def embed(self, text: str) -> list[float]:
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
