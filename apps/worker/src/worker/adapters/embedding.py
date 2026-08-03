"""OpenAI 텍스트 임베딩 어댑터 — httpx 직접 호출 (SDK 없음)."""

from __future__ import annotations

import asyncio
from typing import Protocol

import httpx

from worker.adapters import AdapterClientError, adapter_http_reason

DEFAULT_MODEL = "text-embedding-3-large"
DEFAULT_DIMENSIONS = 1536
DEFAULT_BASE_URL = "https://api.openai.com/v1"


class SupportsEmbed(Protocol):
    model: str

    async def embed(self, text: str) -> list[float]: ...


class EmbeddingError(AdapterClientError):
    """임베딩 업스트림 실패. resolver는 이를 fail-soft로 처리한다."""


class OpenAIEmbeddingClient:
    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_MODEL,
        *,
        dimensions: int = DEFAULT_DIMENSIONS,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 60.0,
    ) -> None:
        if not api_key:
            raise EmbeddingError(
                "OpenAIEmbeddingClient requires a non-empty api_key",
                provider="openai_embedding",
                operation="embed",
                reason_code="not_configured",
            )
        self.model = model
        self.dimensions = dimensions
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        """지연 생성 공유 커넥션 풀 — 요청마다 열지 않는다, aclose가 닫는다."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def embed(self, text: str) -> list[float]:
        try:
            response = await self._http().post(
                f"{self._base_url}/embeddings",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"model": self.model, "input": text, "dimensions": self.dimensions},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            raise EmbeddingError(
                f"OpenAI embedding HTTP {status}",
                provider="openai_embedding",
                operation="embed",
                reason_code=adapter_http_reason(status),
                status_code=status,
            ) from exc
        except httpx.TimeoutException as exc:
            raise EmbeddingError(
                f"OpenAI embedding request failed: {exc}",
                provider="openai_embedding",
                operation="embed",
                reason_code="timeout",
            ) from exc
        except httpx.HTTPError as exc:
            raise EmbeddingError(
                f"OpenAI embedding request failed: {exc}",
                provider="openai_embedding",
                operation="embed",
                reason_code="transport_error",
            ) from exc
        try:
            values = response.json()["data"][0]["embedding"]
            vector = [float(value) for value in values]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise EmbeddingError(
                "OpenAI returned an unexpected embedding payload",
                provider="openai_embedding",
                operation="embed",
                reason_code="invalid_response",
            ) from exc
        if len(vector) != self.dimensions:
            raise EmbeddingError(
                "OpenAI embedding dimension mismatch: "
                f"expected {self.dimensions}, got {len(vector)}",
                provider="openai_embedding",
                operation="embed",
                reason_code="invalid_response",
            )
        return vector

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()


class RequestScopedEmbedding:
    def __init__(self, inner: SupportsEmbed) -> None:
        self._inner = inner
        self._memo: dict[str, asyncio.Task[list[float]]] = {}
        self.model = inner.model

    async def embed(self, text: str) -> list[float]:
        if text not in self._memo:
            self._memo[text] = asyncio.ensure_future(self._inner.embed(text))
        return await self._memo[text]


def request_scoped(client: SupportsEmbed | None) -> RequestScopedEmbedding | None:
    return None if client is None else RequestScopedEmbedding(client)


def build_embedding_client(settings) -> OpenAIEmbeddingClient | None:
    api_key = getattr(settings, "openai_api_key", "")
    if not api_key:
        return None
    return OpenAIEmbeddingClient(
        api_key,
        getattr(settings, "embedding_model", DEFAULT_MODEL) or DEFAULT_MODEL,
        base_url=getattr(settings, "openai_base_url", None) or DEFAULT_BASE_URL,
    )


async def embed_query(text: str, *, client: SupportsEmbed | None) -> list[float] | None:
    if client is None:
        return None
    return await client.embed(text)
