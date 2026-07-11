"""워커 HTTP 클라이언트 — Cloud Run 프라이빗 호출 시 메타데이터 서버 OIDC id-token 첨부.

worker_oidc_audience가 비어 있으면(로컬) 인증 헤더 없이 호출한다.
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


class WorkerClient:
    def __init__(self, settings: Settings):
        self._client = httpx.AsyncClient(
            base_url=settings.worker_base_url,
            timeout=settings.worker_timeout_seconds,
        )
        self._audience = settings.worker_oidc_audience
        self._id_token: str | None = None
        self._id_token_exp = 0.0

    async def aclose(self) -> None:
        await self._client.aclose()

    async def generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/generate", payload)

    async def finalize_job(self, job_id: str) -> dict[str, Any]:
        return await self._post_json("/tasks/finalize", {"job_id": job_id})

    async def motif_candidates(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/motifs/candidates", payload)

    async def motif_generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/motifs/generate", payload)

    async def export(self, payload: dict[str, Any]) -> tuple[bytes, str]:
        """SVG → PNG/TIFF 바이너리. (content, media_type) 반환 — 워커가 dpi/치수의 최종 권위."""
        res = await self._post("/export", payload)
        return res.content, res.headers.get("content-type", "application/octet-stream")

    async def _auth_headers(self) -> dict[str, str]:
        if not self._audience:
            return {}
        # ponytail: 동시 갱신은 중복 fetch 1회로 끝나는 무해한 경쟁 — 락 없이 둔다
        if self._id_token is None or time.time() >= self._id_token_exp - _TOKEN_REFRESH_MARGIN_S:
            try:
                async with httpx.AsyncClient(timeout=5.0) as meta:
                    res = await meta.get(
                        _METADATA_IDENTITY_URL,
                        params={"audience": self._audience},
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
            self._id_token, self._id_token_exp = token, token_exp
        return {"Authorization": f"Bearer {self._id_token}"}

    async def _post(self, path: str, payload: dict[str, Any]) -> httpx.Response:
        try:
            headers = {"X-Request-ID": request_id_var.get(), **(await self._auth_headers())}
            res = await self._client.post(path, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise UpstreamError("이미지 워커 호출에 실패했습니다") from exc
        if res.status_code in (400, 422):
            # 요청 오류(잘못된 intent 등) — 일시 장애(502)와 구분해 detail을 보존 전파.
            raise WorkerRequestError(f"이미지 워커가 요청을 거부했습니다: {_detail_of(res)}")
        if res.status_code >= 400:
            raise UpstreamError("이미지 워커가 요청을 처리하지 못했습니다")
        return res

    async def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        res = await self._post(path, payload)
        try:
            body: Any = res.json()
        except ValueError as exc:
            raise UpstreamError("이미지 워커 응답을 해석하지 못했습니다") from exc
        if not isinstance(body, dict):
            raise UpstreamError("이미지 워커 응답 형식이 올바르지 않습니다")
        return body


def _detail_of(res: httpx.Response) -> str:
    try:
        body = res.json()
        detail = body.get("detail") if isinstance(body, dict) else None
    except ValueError:
        detail = None
    return str(detail) if detail else res.text[:200]


def build_worker_client(settings: Settings) -> WorkerClient:
    return WorkerClient(settings)
