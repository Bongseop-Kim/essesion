"""외부 API 어댑터 배선 (worker-motifs.md §3·§4·§6).

공유 에러 타입은 여기서 정의한다(하위 모듈이 순환 없이 import). `build_adapters`는
설정에서 임베딩·Recraft·Gemini 클라이언트를 만든다 — 키 미설정 시 해당 클라이언트는
None(DryRun): 임베딩은 소프트 유사도 skip, Recraft/Gemini는 미구성 503.
"""

from __future__ import annotations

from dataclasses import dataclass


class AdapterClientError(RuntimeError):
    """외부 어댑터 의존성(LLM/임베딩/벡터라이저)이 실패 — API 경계에서 502로 매핑."""


class AdapterNotConfigured(AdapterClientError):
    """클라이언트 미주입·미구성 — 라우트에서 503으로 매핑."""


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
