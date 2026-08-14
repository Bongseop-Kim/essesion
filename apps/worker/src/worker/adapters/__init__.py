"""외부 API 어댑터 배선 (worker-motifs.md §3·§4·§6).

공유 에러 타입은 여기서 정의한다(하위 모듈이 순환 없이 import). `build_adapters`는
설정에서 임베딩·GPT Image·LLM·Motif 비전 태깅 클라이언트를 만든다 — 키 미설정 시 클라이언트는
None(비활성). 비활성의 의미는 어댑터마다 다르다: 임베딩만 소프트 skip(유사도 단계
생략), GPT Image/LLM은 요청 시 503(AdapterNotConfigured). GCS ObjectStore는 로컬에서
fake-gcs-server를 사용하고 배포 환경에서는 필수 설정이 빠지면 기동을 중단한다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


def log_provider_usage(body: object, *, provider: str, operation: str, model: str) -> None:
    """provider 응답의 `usage`를 그대로 로그에 남긴다 — 토큰 단가 실측의 유일한 근거.

    ponytail: 필드명 정규화 없이 dict 원문 — provider가 필드를 바꾸거나 늘려도(images는
    input_tokens, chat은 prompt_tokens) 코드 수정 없이 실측에 잡힌다. DB 집계 테이블은
    로그 기반 집계로 부족해지면 그때.
    """
    usage = body.get("usage") if isinstance(body, dict) else None
    if isinstance(usage, dict):
        logger.info(
            "provider_usage provider=%s operation=%s model=%s usage=%s",
            provider,
            operation,
            model,
            usage,
        )


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
    gpt_image: object | None = None
    llm: object | None = None
    motif_tagging: object | None = None

    async def aclose(self) -> None:
        for client in (self.embedding, self.gpt_image, self.llm, self.motif_tagging):
            close = getattr(client, "aclose", None)
            if close is not None:
                await close()


def build_adapters(settings) -> Adapters:
    """설정 → Adapters. 순환 방지를 위해 하위 모듈을 함수 안에서 import."""
    from worker.adapters.embedding import build_embedding_client
    from worker.adapters.gpt_image import build_gpt_image_client
    from worker.adapters.llm import build_llm_client
    from worker.adapters.motif_tagging import build_motif_tagging_client

    return Adapters(
        embedding=build_embedding_client(settings),
        gpt_image=build_gpt_image_client(settings),
        llm=build_llm_client(settings),
        motif_tagging=build_motif_tagging_client(settings),
    )
