"""Solapi 문자/알림톡 (docs/api-spec/domains.md §1).

인증: HMAC-SHA256(secret, date+salt) 헤더. 실패는 예외 대신 False(원 동작 —
발송 실패가 본 트랜잭션을 깨지 않게 호출부에서 처리).
DryRun은 보낸 메시지를 sent 리스트에 쌓는다(로컬 확인·테스트용).
"""

import hashlib
import hmac
import logging
import uuid
from datetime import UTC, datetime
from typing import Protocol

import httpx

from api.config import Settings

logger = logging.getLogger(__name__)

SEND_URL = "https://api.solapi.com/messages/v4/send"


class SolapiClient(Protocol):
    async def send_sms(self, to: str, text: str) -> bool: ...

    async def send_alimtalk(
        self, to: str, template_id: str, variables: dict[str, str], fallback_text: str
    ) -> bool: ...


class RealSolapiClient:
    def __init__(self, settings: Settings):
        self._api_key = settings.solapi_api_key
        self._api_secret = settings.solapi_api_secret
        self._sender = settings.solapi_sender_number
        self._pf_id = settings.solapi_pf_id

    def _auth_header(self) -> str:
        date = datetime.now(UTC).isoformat()
        salt = str(uuid.uuid4())
        signature = hmac.new(
            self._api_secret.encode(), (date + salt).encode(), hashlib.sha256
        ).hexdigest()
        return (
            f"HMAC-SHA256 apiKey={self._api_key}, date={date}, salt={salt}, signature={signature}"
        )

    async def _send(self, message: dict) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.post(
                    SEND_URL,
                    json={"message": message},
                    headers={"Authorization": self._auth_header()},
                )
            if not res.is_success:
                logger.error("solapi 발송 실패: %s %s", res.status_code, res.text[:200])
            return res.is_success
        except httpx.HTTPError:
            logger.exception("solapi 요청 예외")
            return False

    async def send_sms(self, to: str, text: str) -> bool:
        return await self._send({"to": to, "from": self._sender, "text": text, "type": "SMS"})

    async def send_alimtalk(
        self, to: str, template_id: str, variables: dict[str, str], fallback_text: str
    ) -> bool:
        return await self._send(
            {
                "to": to,
                "from": self._sender,
                "text": fallback_text,
                "type": "ATA",
                "kakaoOptions": {
                    "pfId": self._pf_id,
                    "templateId": template_id,
                    "variables": variables,
                    "disableSms": False,  # 알림톡 실패 시 SMS 자동 대체
                },
            }
        )


class DryRunSolapiClient:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_sms(self, to: str, text: str) -> bool:
        logger.info("DRYRUN sms → %s: %s", to, text)
        self.sent.append({"type": "SMS", "to": to, "text": text})
        return True

    async def send_alimtalk(
        self, to: str, template_id: str, variables: dict[str, str], fallback_text: str
    ) -> bool:
        logger.info("DRYRUN alimtalk → %s: %s %s", to, template_id, variables)
        self.sent.append(
            {"type": "ATA", "to": to, "template_id": template_id, "text": fallback_text}
        )
        return True


def build_solapi_client(settings: Settings) -> SolapiClient:
    if settings.solapi_api_key and settings.solapi_api_secret and settings.solapi_sender_number:
        return RealSolapiClient(settings)
    logger.warning("SOLAPI 설정 없음 — DryRun Solapi 클라이언트로 동작")
    return DryRunSolapiClient()
