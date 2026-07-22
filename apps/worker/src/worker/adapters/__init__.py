"""외부 API 어댑터 배선 (worker-motifs.md §3·§4·§6).

공유 에러 타입은 여기서 정의한다(하위 모듈이 순환 없이 import). `build_adapters`는
설정에서 임베딩·Recraft·Gemini 클라이언트를 만든다 — 키 미설정 시 해당 클라이언트는
None(비활성). 비활성의 의미는 어댑터마다 다르다: 임베딩만 소프트 skip(유사도 단계
생략), Recraft/Gemini는 요청 시 503(AdapterNotConfigured). 진짜 DryRun(no-op으로
성공하는 것)은 GCS ObjectStore(integrations.DryRunObjectStore)뿐이다.
"""

from __future__ import annotations

from dataclasses import dataclass


class AdapterClientError(RuntimeError):
    """외부 어댑터 의존성(LLM/임베딩/벡터라이저)이 실패 — API 경계에서 502로 매핑."""

    def __init__(
        self,
        message: str,
        *,
        provider: str = "external",
        operation: str = "request",
        reason_code: str = "request_failed",
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        self.operation = operation
        self.reason_code = reason_code
        self.status_code = status_code


class AdapterNotConfigured(AdapterClientError):
    """클라이언트 미주입·미구성 — 라우트에서 503으로 매핑."""


def adapter_http_reason(status_code: int) -> str:
    if status_code in (401, 403):
        return "authentication_failed"
    if status_code == 429:
        return "rate_limited"
    return "provider_5xx" if status_code >= 500 else "provider_4xx"


@dataclass
class Adapters:
    """요청 핸들러가 쓰는 어댑터 묶음 — 미구성 클라이언트는 None."""

    embedding: object | None = None
    recraft: object | None = None
    gemini: object | None = None

    async def aclose(self) -> None:
        for client in (self.embedding, self.recraft, self.gemini):
            close = getattr(client, "aclose", None)
            if close is not None:
                await close()


def build_adapters(settings) -> Adapters:
    """설정 → Adapters. 순환 방지를 위해 하위 모듈을 함수 안에서 import."""
    from worker.adapters.embedding import build_embedding_client
    from worker.adapters.gemini import build_gemini_client
    from worker.adapters.recraft import build_recraft_client

    return Adapters(
        embedding=build_embedding_client(settings),
        recraft=build_recraft_client(settings),
        gemini=build_gemini_client(settings),
    )
