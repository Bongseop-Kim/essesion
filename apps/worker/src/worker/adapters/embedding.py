"""임베딩 어댑터 (worker-motifs.md §4): text → vector, 디스크립터 소프트 유사도용.

OpenAI text-embedding-3-small(1536), httpx 직접 POST /v1/embeddings, 30s. 실패는
EmbeddingError(502급)로 전파(임의 재사용 은폐 금지). 키 미설정은 클라이언트 None →
embed_query가 graceful None을 반환(이것이 DryRun) → resolver가 소프트 유사도 단계 skip.
"""

from __future__ import annotations

import asyncio
from typing import Protocol

import httpx

from worker.adapters import AdapterClientError, adapter_http_reason

DEFAULT_MODEL = "text-embedding-3-small"


class SupportsEmbed(Protocol):
    model: str

    async def embed(self, text: str) -> list[float]: ...


class EmbeddingError(AdapterClientError):
    """임베딩 업스트림 실패(502급). resolver는 이를 fail-soft로 다룬다."""


class OpenAIEmbeddingClient:
    """embed(text) → list[float] — OpenAI /v1/embeddings 직접 POST (SDK 없음)."""

    def __init__(self, api_key: str, model: str = DEFAULT_MODEL) -> None:
        if not api_key:
            raise EmbeddingError(
                "OpenAIEmbeddingClient requires a non-empty api_key",
                provider="openai_embedding",
                operation="embed",
                reason_code="not_configured",
            )
        self.model = model
        self._api_key = api_key
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        """지연 생성 공유 커넥션 풀 — 요청마다 열지 않는다, aclose가 닫는다."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def embed(self, text: str) -> list[float]:
        try:
            resp = await self._http().post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"model": self.model, "input": text},
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise EmbeddingError(
                f"OpenAI embedding request failed: {exc}",
                provider="openai_embedding",
                operation="embed",
                reason_code=adapter_http_reason(exc.response.status_code),
                status_code=exc.response.status_code,
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
            return list(resp.json()["data"][0]["embedding"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise EmbeddingError(
                f"OpenAI returned an unexpected payload: {exc}",
                provider="openai_embedding",
                operation="embed",
                reason_code="invalid_response",
            ) from exc

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()


class RequestScopedEmbedding:
    """요청 스코프 메모 — 같은 descriptor 텍스트를 요청 내 1회만 임베딩.

    수명이 한 요청이므로 프로세스-로컬 상태 금지 원칙(ARCHITECTURE §7)과 무관.
    여러 design/spec이 같은 descriptor를 공유할 때 OpenAI 중복 호출을 제거한다.
    """

    def __init__(self, inner: SupportsEmbed) -> None:
        self._inner = inner
        # 완료 결과가 아닌 진행 중 Task를 메모 — 동시 호출도 단일 inner.embed를 공유
        self._memo: dict[str, asyncio.Task[list[float]]] = {}
        self.model = inner.model

    async def embed(self, text: str) -> list[float]:
        if text not in self._memo:
            self._memo[text] = asyncio.ensure_future(self._inner.embed(text))
        return await self._memo[text]


def request_scoped(client: SupportsEmbed | None) -> RequestScopedEmbedding | None:
    """요청 초입에서 감싼다 — None(미구성)은 그대로 통과."""
    return None if client is None else RequestScopedEmbedding(client)


def build_embedding_client(settings) -> OpenAIEmbeddingClient | None:
    """키 있으면 클라이언트, 없으면 None(graceful DryRun)."""
    api_key = getattr(settings, "openai_api_key", "")
    if not api_key:
        return None
    model = getattr(settings, "embedding_model", None) or DEFAULT_MODEL
    return OpenAIEmbeddingClient(api_key, model)


async def embed_query(text: str, *, client: SupportsEmbed | None) -> list[float] | None:
    """text 임베딩, 클라이언트 없으면 None. 업스트림 실패는 EmbeddingError로 전파."""
    if client is None:
        return None
    return await client.embed(text)
