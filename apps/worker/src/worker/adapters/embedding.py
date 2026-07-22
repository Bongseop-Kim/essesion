"""Vertex AI text embedding adapter using ADC and the official Google SDK."""

from __future__ import annotations

import asyncio
from typing import Protocol

from google import genai
from google.genai import types

from worker.adapters import AdapterClientError, adapter_http_reason

DEFAULT_MODEL = "gemini-embedding-001"
DEFAULT_DIMENSION = 3072


class SupportsEmbed(Protocol):
    model: str

    async def embed(self, text: str, *, task_type: str = "RETRIEVAL_QUERY") -> list[float]: ...


class EmbeddingError(AdapterClientError):
    """Vertex 임베딩 업스트림 실패. resolver는 이를 fail-soft로 처리한다."""


class VertexEmbeddingClient:
    def __init__(
        self,
        project: str,
        location: str = "global",
        model: str = DEFAULT_MODEL,
        *,
        output_dimensionality: int = DEFAULT_DIMENSION,
        client: genai.Client | None = None,
    ) -> None:
        if not project and client is None:
            raise EmbeddingError(
                "VertexEmbeddingClient requires a GCP project",
                provider="vertex_embedding",
                operation="embed",
                reason_code="not_configured",
            )
        self.model = model
        self.output_dimensionality = output_dimensionality
        self._client = client or genai.Client(vertexai=True, project=project, location=location)

    async def embed(self, text: str, *, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
        try:
            response = await self._client.aio.models.embed_content(
                model=self.model,
                contents=text,
                config=types.EmbedContentConfig(
                    task_type=task_type,
                    output_dimensionality=self.output_dimensionality,
                ),
            )
        except Exception as exc:  # SDK exception classes vary by version.
            status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
            status = (
                int(status)
                if isinstance(status, int | str) and str(status).isdigit()
                else None
            )
            reason = adapter_http_reason(status) if status is not None else "provider_error"
            raise EmbeddingError(
                f"Vertex embedding request failed: {exc}",
                provider="vertex_embedding",
                operation="embed",
                reason_code=reason,
                status_code=status,
            ) from exc
        try:
            embeddings = response.embeddings
            if not embeddings or embeddings[0].values is None:
                raise ValueError("missing embeddings")
            values = embeddings[0].values
            vector = list(values)
        except (AttributeError, IndexError, TypeError, ValueError) as exc:
            raise EmbeddingError(
                f"Vertex returned an unexpected embedding payload: {exc}",
                provider="vertex_embedding",
                operation="embed",
                reason_code="invalid_response",
            ) from exc
        if len(vector) != self.output_dimensionality:
            raise EmbeddingError(
                "Vertex embedding dimension mismatch: "
                f"expected {self.output_dimensionality}, got {len(vector)}",
                provider="vertex_embedding",
                operation="embed",
                reason_code="invalid_response",
            )
        return vector

    async def aclose(self) -> None:
        close = getattr(self._client.aio, "aclose", None)
        if close is not None:
            await close()


class RequestScopedEmbedding:
    def __init__(self, inner: SupportsEmbed) -> None:
        self._inner = inner
        self._memo: dict[tuple[str, str], asyncio.Task[list[float]]] = {}
        self.model = inner.model

    async def embed(self, text: str, *, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
        key = (text, task_type)
        if key not in self._memo:
            self._memo[key] = asyncio.ensure_future(self._inner.embed(text, task_type=task_type))
        return await self._memo[key]


def request_scoped(client: SupportsEmbed | None) -> RequestScopedEmbedding | None:
    return None if client is None else RequestScopedEmbedding(client)


def build_embedding_client(settings) -> VertexEmbeddingClient | None:
    project = getattr(settings, "gcp_project_id", "")
    if not project:
        return None
    return VertexEmbeddingClient(
        project,
        getattr(settings, "vertex_ai_location", "global"),
        getattr(settings, "embedding_model", DEFAULT_MODEL) or DEFAULT_MODEL,
        output_dimensionality=getattr(
            settings, "embedding_output_dimensionality", DEFAULT_DIMENSION
        ),
    )


async def embed_query(
    text: str, *, client: SupportsEmbed | None, task_type: str = "RETRIEVAL_QUERY"
) -> list[float] | None:
    if client is None:
        return None
    try:
        return await client.embed(text, task_type=task_type)
    except TypeError as exc:
        # Compatibility with lightweight test/dry-run clients implementing the old protocol.
        if "task_type" not in str(exc):
            raise
        return await client.embed(text)
