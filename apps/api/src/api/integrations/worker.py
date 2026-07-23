"""워커 HTTP 클라이언트 — Cloud Run 프라이빗 호출 시 메타데이터 서버 OIDC id-token 첨부.

generate/finalize는 서로 다른 Cloud Run audience다. audience가 비어 있으면(로컬) 인증 없이
호출하고, finalize URL이 비어 있으면 단일 로컬 worker base URL로 폴백한다.
"""

import base64
import json
import time
from typing import Any

import httpx
from obs import request_id_var

from api.config import Settings
from api.errors import UpstreamError, WorkerRequestError

_METADATA_IDENTITY_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"
)
_TOKEN_REFRESH_MARGIN_S = 60

_WORKER_REJECTION_MESSAGES = {
    "authoring_invalid": "디자인 구성을 만들지 못했습니다",
    "constraint_conflict": "선택한 디자인 설정을 함께 적용할 수 없습니다",
    "reference_invalid": "참고 이미지를 디자인에 사용할 수 없습니다",
    "intent_invalid": "선택한 디자인 정보를 처리할 수 없습니다",
    "candidate_invalid": "디자인 후보를 완성하지 못했습니다",
    "semantic_mismatch": "요청한 주제와 맞는 모티프 구성을 만들지 못했습니다",
}
_WORKER_REJECTION_STAGES = {
    "authoring_invalid": "authoring",
    "constraint_conflict": "constraints",
    "reference_invalid": "reference",
    "intent_invalid": "intent",
    "candidate_invalid": "candidate",
    "semantic_mismatch": "authoring",
}


class WorkerClient:
    def __init__(self, settings: Settings):
        if settings.env in ("local", "test"):
            self.capability_mode = "local"
        else:
            configured = all(
                (
                    settings.worker_base_url.startswith("https://"),
                    settings.worker_oidc_audience,
                    settings.worker_finalize_url.startswith("https://"),
                    settings.worker_finalize_oidc_audience,
                )
            )
            self.capability_mode = "ready" if configured else "unavailable"
        self._generate_client = httpx.AsyncClient(
            base_url=settings.worker_base_url,
            timeout=settings.worker_timeout_seconds,
        )
        finalize_url = settings.worker_finalize_url or settings.worker_base_url
        self._finalize_client = httpx.AsyncClient(
            base_url=finalize_url,
            timeout=settings.worker_timeout_seconds,
        )
        self._generate_audience = settings.worker_oidc_audience
        self._finalize_audience = (
            settings.worker_finalize_oidc_audience
            if settings.worker_finalize_url
            else settings.worker_oidc_audience
        )
        self._tokens: dict[str, tuple[str, float]] = {}

    async def aclose(self) -> None:
        await self._generate_client.aclose()
        await self._finalize_client.aclose()

    async def generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/generate", payload)

    async def finalize_job(self, job_id: str) -> dict[str, Any]:
        return await self._post_json("/tasks/finalize", {"job_id": job_id}, finalize=True)

    async def motif_candidates(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/motifs/candidates", payload)

    async def motif_generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/motifs/generate", payload)

    async def motif_import(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/motifs/import", payload)

    async def motif_text_preview(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/motifs/text-preview", payload)

    async def motif_photo_preview(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/motifs/photo-preview", payload)

    async def palette_extract(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/palette/extract", payload)

    async def ideas(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/ideas", payload)

    async def scan_authoring_promotions(self, *, limit: int = 100) -> dict[str, Any]:
        return await self._post_json("/authoring/promotions/scan", {"limit": limit})

    async def ensure_authoring_promotion_embedding(self, candidate_id: str) -> dict[str, Any]:
        return await self._post_json(
            "/authoring/promotions/embedding",
            {"candidate_id": candidate_id},
        )

    async def export(self, payload: dict[str, Any]) -> tuple[bytes, str]:
        """SVG → PNG/TIFF 바이너리. (content, media_type) 반환 — 워커가 dpi/치수의 최종 권위."""
        res = await self._post("/export", payload, finalize=True)
        return res.content, res.headers.get("content-type", "application/octet-stream")

    async def _auth_headers(self, audience: str) -> dict[str, str]:
        if not audience:
            return {}
        # ponytail: 동시 갱신은 중복 fetch 1회로 끝나는 무해한 경쟁 — 락 없이 둔다
        cached = self._tokens.get(audience)
        if cached is None or time.time() >= cached[1] - _TOKEN_REFRESH_MARGIN_S:
            try:
                async with httpx.AsyncClient(timeout=5.0) as meta:
                    res = await meta.get(
                        _METADATA_IDENTITY_URL,
                        params={"audience": audience},
                        headers={"Metadata-Flavor": "Google"},
                    )
                    res.raise_for_status()
            except httpx.HTTPError as exc:
                raise UpstreamError("워커 인증 토큰 발급에 실패했습니다") from exc
            token = res.text.strip()
            try:
                claims = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
                token_exp = float(claims["exp"])
            except (IndexError, KeyError, TypeError, ValueError) as exc:
                raise UpstreamError("워커 인증 토큰 형식이 올바르지 않습니다") from exc
            cached = (token, token_exp)
            self._tokens[audience] = cached
        return {"Authorization": f"Bearer {cached[0]}"}

    async def _post(
        self, path: str, payload: dict[str, Any], *, finalize: bool = False
    ) -> httpx.Response:
        client = self._finalize_client if finalize else self._generate_client
        audience = self._finalize_audience if finalize else self._generate_audience
        try:
            headers = {"X-Request-ID": request_id_var.get(), **(await self._auth_headers(audience))}
            res = await client.post(path, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise UpstreamError("이미지 워커 호출에 실패했습니다") from exc
        if res.status_code in (400, 422):
            # 워커의 고정 오류 계약만 보존한다. 모델/검증 원문은 사용자 응답으로
            # 흘리지 않아 프롬프트·내부 경로·provider 세부정보 노출을 막는다.
            if path == "/generate":
                raise _worker_rejection(res)
            raise WorkerRequestError("이미지 워커가 요청을 거부했습니다")
        if res.status_code >= 400:
            raise UpstreamError("이미지 워커가 요청을 처리하지 못했습니다")
        return res

    async def _post_json(
        self, path: str, payload: dict[str, Any], *, finalize: bool = False
    ) -> dict[str, Any]:
        res = await self._post(path, payload, finalize=finalize)
        try:
            body: Any = res.json()
        except ValueError as exc:
            raise UpstreamError("이미지 워커 응답을 해석하지 못했습니다") from exc
        if not isinstance(body, dict):
            raise UpstreamError("이미지 워커 응답 형식이 올바르지 않습니다")
        return body


def _worker_rejection(res: httpx.Response) -> WorkerRequestError:
    try:
        body = res.json()
    except ValueError:
        body = None
    detail = body.get("detail") if isinstance(body, dict) else None
    code = detail.get("code") if isinstance(detail, dict) else None
    if code in _WORKER_REJECTION_MESSAGES:
        return WorkerRequestError(
            _WORKER_REJECTION_MESSAGES[code],
            code=code,
            stage=_WORKER_REJECTION_STAGES[code],
        )
    return WorkerRequestError()


def build_worker_client(settings: Settings) -> WorkerClient:
    return WorkerClient(settings)
