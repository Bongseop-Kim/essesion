"""임베딩 어댑터 (worker-motifs.md §4): text → vector, 디스크립터 소프트 유사도용.

OpenAI text-embedding-3-small(1536), httpx 직접 POST /v1/embeddings, 30s. 실패는
EmbeddingError(502급)로 전파(임의 재사용 은폐 금지). 키 미설정은 클라이언트 None →
embed_query가 graceful None을 반환(이것이 DryRun) → resolver가 소프트 유사도 단계 skip.
"""

from __future__ import annotations

import httpx

from worker.adapters import AdapterClientError

DEFAULT_MODEL = "text-embedding-3-small"


class EmbeddingError(AdapterClientError):
    """임베딩 업스트림 실패(502급). resolver는 이를 fail-soft로 다룬다."""


class OpenAIEmbeddingClient:
    """embed(text) → list[float] — OpenAI /v1/embeddings 직접 POST (SDK 없음)."""

    def __init__(self, api_key: str, model: str = DEFAULT_MODEL) -> None:
        if not api_key:
            raise EmbeddingError("OpenAIEmbeddingClient requires a non-empty api_key")
        self.model = model
        self._api_key = api_key

    async def embed(self, text: str) -> list[float]:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json={"model": self.model, "input": text},
                )
                resp.raise_for_status()
        except Exception as exc:  # transport / HTTP / API 실패
            raise EmbeddingError(f"OpenAI embedding request failed: {exc}") from exc
        try:
            return list(resp.json()["data"][0]["embedding"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise EmbeddingError(f"OpenAI returned an unexpected payload: {exc}") from exc

    async def aclose(self) -> None:  # AsyncClient를 요청마다 열고 닫으므로 no-op
        return None


def build_embedding_client(settings) -> OpenAIEmbeddingClient | None:
    """키 있으면 클라이언트, 없으면 None(graceful DryRun)."""
    api_key = getattr(settings, "openai_api_key", "")
    if not api_key:
        return None
    model = getattr(settings, "embedding_model", None) or DEFAULT_MODEL
    return OpenAIEmbeddingClient(api_key, model)


async def embed_query(text: str, *, client: OpenAIEmbeddingClient | None) -> list[float] | None:
    """text 임베딩, 클라이언트 없으면 None. 업스트림 실패는 EmbeddingError로 전파."""
    if client is None:
        return None
    return await client.embed(text)
