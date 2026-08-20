"""OpenAI 텍스트 임베딩 어댑터 — httpx 직접 호출 (SDK 없음)."""

from __future__ import annotations

import asyncio
from typing import Protocol

import httpx

from worker.adapters import AdapterClientError, adapter_http_reason, log_provider_usage

DEFAULT_MODEL = "text-embedding-3-large"
DEFAULT_DIMENSIONS = 1536
DEFAULT_BASE_URL = "https://api.openai.com/v1"

# llm._chat과 동일한 일시 오류 재시도 정책
_RETRYABLE = frozenset({429, 500, 502, 503})
_MAX_ATTEMPTS = 4
_BASE_DELAY_S = 0.5


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
        return (await self.embed_batch([text]))[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """/embeddings 배열 입력 — 인덱싱·백필의 1건당 1 HTTP를 배치 1 HTTP로."""
        if not texts:
            return []
        body = await self._request(list(texts))
        try:
            rows = list(body["data"])
            indices = [row.get("index") for row in rows]
            if any(index is not None for index in indices):
                # 중복·누락·혼재·범위 밖이면 벡터가 엉뚱한 텍스트에 붙는다 — 조용히 정렬하지 않는다.
                if None in indices or sorted(indices) != list(range(len(rows))):
                    raise ValueError(f"invalid embedding indices: {indices}")
                rows.sort(key=lambda row: row["index"])
            # index가 전부 없으면 응답 순서(=입력 순서)를 그대로 쓴다.
            vectors = [[float(value) for value in row["embedding"]] for row in rows]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise EmbeddingError(
                "OpenAI returned an unexpected embedding payload",
                provider="openai_embedding",
                operation="embed",
                reason_code="invalid_response",
            ) from exc
        if len(vectors) != len(texts):
            raise EmbeddingError(
                f"OpenAI embedding batch size mismatch: expected {len(texts)}, got {len(vectors)}",
                provider="openai_embedding",
                operation="embed",
                reason_code="invalid_response",
            )
        for vector in vectors:
            self._check_dimensions(vector)
        return vectors

    def _check_dimensions(self, vector: list[float]) -> None:
        if len(vector) != self.dimensions:
            raise EmbeddingError(
                "OpenAI embedding dimension mismatch: "
                f"expected {self.dimensions}, got {len(vector)}",
                provider="openai_embedding",
                operation="embed",
                reason_code="invalid_response",
            )

    async def _request(self, texts: list[str]) -> dict:
        response: httpx.Response | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = await self._http().post(
                    f"{self._base_url}/embeddings",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json={"model": self.model, "input": texts, "dimensions": self.dimensions},
                )
            except httpx.TimeoutException as exc:
                raise EmbeddingError(
                    "OpenAI embedding request timed out",
                    provider="openai_embedding",
                    operation="embed",
                    reason_code="timeout",
                ) from exc
            except httpx.HTTPError as exc:
                raise EmbeddingError(
                    "OpenAI embedding transport error",
                    provider="openai_embedding",
                    operation="embed",
                    reason_code="transport_error",
                ) from exc
            if response.status_code in _RETRYABLE and attempt < _MAX_ATTEMPTS - 1:
                await asyncio.sleep(_BASE_DELAY_S * 2**attempt)
                continue
            break
        assert response is not None  # 루프는 예외 또는 break로만 끝난다
        try:
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
        try:
            body = response.json()
        except ValueError as exc:
            raise EmbeddingError(
                "OpenAI returned an unexpected embedding payload",
                provider="openai_embedding",
                operation="embed",
                reason_code="invalid_response",
            ) from exc
        log_provider_usage(
            body,
            provider="openai_embedding",
            operation="embed",
            model=self.model,
        )
        return body

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()


class RequestScopedEmbedding:
    def __init__(self, inner: SupportsEmbed) -> None:
        self._inner = inner
        self._memo: dict[str, asyncio.Task[list[float]]] = {}
        self.model = inner.model

    async def embed(self, text: str) -> list[float]:
        # 공백 차이로 메모가 갈리지 않게 키만 정규화한다 — 전송 텍스트는 원문 유지.
        key = text.strip()
        if key not in self._memo:
            self._memo[key] = asyncio.ensure_future(self._inner.embed(text))
        return await self._memo[key]


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
