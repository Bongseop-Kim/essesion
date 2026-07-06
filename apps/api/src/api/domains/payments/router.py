from typing import Any

from fastapi import APIRouter, Request

from api.db import SessionDep
from api.deps import CurrentUser
from api.domains.payments import service
from api.domains.payments.schemas import (
    PaymentConfirmRequest,
    PaymentConfirmResponse,
    WebhookResult,
)

router = APIRouter(tags=["payments"])


@router.post("/payments/confirm", response_model=PaymentConfirmResponse)
async def confirm_payment(
    body: PaymentConfirmRequest, session: SessionDep, user: CurrentUser, request: Request
) -> PaymentConfirmResponse:
    return await service.confirm_payment(session, user, request.app.state.toss, body)


@router.post("/payments/webhook", response_model=WebhookResult)
async def toss_webhook(
    payload: dict[str, Any], session: SessionDep, request: Request
) -> WebhookResult:
    """Toss 상태 변경 웹훅 — 공개 엔드포인트(인증 없음).

    페이로드를 신뢰하지 않고 조회 API로 재검증하므로 위조 요청은 무해하다
    (Toss 공식 권장 검증 방식). 대시보드에 URL 등록은 스테이징 개통 시.
    """
    result = await service.reconcile_from_webhook(session, request.app.state.toss, payload)
    return WebhookResult(**result)
