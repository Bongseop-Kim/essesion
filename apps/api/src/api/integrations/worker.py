"""워커 HTTP 클라이언트 — Cloud Run 프라이빗 호출 시 메타데이터 서버 OIDC id-token 첨부.

audience가 비어 있으면(로컬) 인증 없이 호출한다.
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

# 워커의 고정 오류 코드 → (고객 문구, 422 stage). stage=None이면 응답에 담지 않는다.
# 사진 코드는 사용자가 다른 사진으로 고칠 수 있는 조건이라 문구가 무엇을 바꿔야 하는지 말한다.
_WORKER_REJECTIONS: dict[str, tuple[str, str | None]] = {
    "constraint_conflict": ("선택한 디자인 설정을 함께 적용할 수 없습니다", "constraints"),
    "intent_invalid": ("선택한 디자인 정보를 처리할 수 없습니다", "intent"),
    "photo_background_unclear": (
        "배경이 고르지 않아 사진에서 그림만 오려내지 못했습니다. "
        "배경이 단색에 가까운 사진을 골라 주세요",
        None,
    ),
    "photo_too_detailed": (
        "사진이 너무 복잡해 단순한 그림으로 바꾸지 못했습니다. "
        "형태가 또렷하고 색이 적은 사진을 골라 주세요",
        None,
    ),
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
                )
            )
            self.capability_mode = "ready" if configured else "unavailable"
        self._client = httpx.AsyncClient(
            base_url=settings.worker_base_url,
            timeout=settings.worker_timeout_seconds,
        )
        self._audience = settings.worker_oidc_audience
        self._tokens: dict[str, tuple[str, float]] = {}

    async def aclose(self) -> None:
        await self._client.aclose()

    async def generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/generate", payload)

    async def motif_import(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/motifs/import", payload)

    async def motif_photo_preview(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post_json("/motifs/photo-preview", payload)

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

    async def _post(self, path: str, payload: dict[str, Any]) -> httpx.Response:
        try:
            headers = {
                "X-Request-ID": request_id_var.get(),
                **(await self._auth_headers(self._audience)),
            }
            res = await self._client.post(path, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise UpstreamError("이미지 워커 호출에 실패했습니다") from exc
        if res.status_code in (400, 422):
            # 워커의 고정 오류 계약만 보존한다. 모델/검증 원문은 사용자 응답으로
            # 흘리지 않아 프롬프트·내부 경로·provider 세부정보 노출을 막는다.
            if path in ("/generate", "/motifs/photo-preview"):
                raise _worker_rejection(res)
            raise WorkerRequestError("이미지 워커가 요청을 거부했습니다")
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


def _worker_rejection(res: httpx.Response) -> WorkerRequestError:
    try:
        body = res.json()
    except ValueError:
        body = None
    detail = body.get("detail") if isinstance(body, dict) else None
    code = detail.get("code") if isinstance(detail, dict) else None
    if code in _WORKER_REJECTIONS:
        message, stage = _WORKER_REJECTIONS[code]
        return WorkerRequestError(message, code=code, stage=stage)
    return WorkerRequestError()
