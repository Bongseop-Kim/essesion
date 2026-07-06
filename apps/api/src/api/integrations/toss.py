"""Toss Payments — 승인/취소 (docs/api-spec/money.md §5·§6).

인증: `Authorization: Basic base64(secret_key + ":")`. 멱등키 헤더는 원 시스템과
동일하게 미사용 — 멱등성은 DB 상태(lock/confirm)가 보장한다.
시크릿이 비어 있으면 DryRun: 항상 성공 응답(로컬 개발·시드 플로우용).
"""

import base64
import logging
from dataclasses import dataclass
from typing import Protocol

import httpx

from api.config import Settings

logger = logging.getLogger(__name__)

BASE_URL = "https://api.tosspayments.com"


@dataclass
class TossResult:
    ok: bool
    status: int
    body: dict


class TossClient(Protocol):
    async def confirm(self, payment_key: str, order_id: str, amount: int) -> TossResult: ...

    async def cancel(
        self, payment_key: str, reason: str, cancel_amount: int | None = None
    ) -> TossResult: ...

    async def get_payment(self, payment_key: str) -> TossResult: ...

    async def aclose(self) -> None: ...


class RealTossClient:
    def __init__(self, secret_key: str):
        auth = base64.b64encode(f"{secret_key}:".encode()).decode()
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
            timeout=30,
        )

    async def confirm(self, payment_key: str, order_id: str, amount: int) -> TossResult:
        res = await self._client.post(
            "/v1/payments/confirm",
            json={"paymentKey": payment_key, "orderId": order_id, "amount": amount},
        )
        return TossResult(ok=res.is_success, status=res.status_code, body=res.json())

    async def cancel(
        self, payment_key: str, reason: str, cancel_amount: int | None = None
    ) -> TossResult:
        body: dict = {"cancelReason": reason}
        if cancel_amount is not None:  # 생략 = 전액 취소
            body["cancelAmount"] = cancel_amount
        res = await self._client.post(f"/v1/payments/{payment_key}/cancel", json=body)
        return TossResult(ok=res.is_success, status=res.status_code, body=res.json())

    async def get_payment(self, payment_key: str) -> TossResult:
        """결제 단건 조회 — 웹훅 페이로드 재검증·ALREADY_PROCESSED 복구용."""
        res = await self._client.get(f"/v1/payments/{payment_key}")
        return TossResult(ok=res.is_success, status=res.status_code, body=res.json())

    async def aclose(self) -> None:
        await self._client.aclose()


class DryRunTossClient:
    async def confirm(self, payment_key: str, order_id: str, amount: int) -> TossResult:
        logger.info("DRYRUN toss confirm: order_id=%s amount=%s", order_id, amount)
        return TossResult(ok=True, status=200, body={"paymentKey": payment_key, "status": "DONE"})

    async def cancel(
        self, payment_key: str, reason: str, cancel_amount: int | None = None
    ) -> TossResult:
        logger.info("DRYRUN toss cancel: reason=%s amount=%s", reason, cancel_amount)
        return TossResult(ok=True, status=200, body={"status": "CANCELED"})

    async def get_payment(self, payment_key: str) -> TossResult:
        logger.info("DRYRUN toss get_payment: %s", payment_key)
        return TossResult(
            ok=True,
            status=200,
            body={"paymentKey": payment_key, "status": "DONE", "orderId": "", "totalAmount": 0},
        )

    async def aclose(self) -> None:
        pass


def build_toss_client(settings: Settings) -> TossClient:
    if settings.toss_secret_key:
        return RealTossClient(settings.toss_secret_key)
    logger.warning("TOSS_SECRET_KEY 없음 — DryRun Toss 클라이언트로 동작")
    return DryRunTossClient()
