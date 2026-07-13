from fastapi import APIRouter, Request

from api.db import SessionDep
from api.deps import CurrentUser
from api.domains.auth.rate_limit import client_rate_limit_key, request_client_ip
from api.domains.payments import service
from api.domains.payments.schemas import (
    PaymentConfirmRequest,
    PaymentConfirmResponse,
    TossWebhookRequest,
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
    payload: TossWebhookRequest, session: SessionDep, request: Request
) -> WebhookResult:
    """Toss 상태 변경 웹훅 — 공개 엔드포인트(인증 없음).

    페이로드를 신뢰하지 않고 조회 API로 재검증하므로 위조 요청은 무해하다
    (Toss 공식 권장 검증 방식). 대시보드에 URL 등록은 스테이징 개통 시.
    """
    request.app.state.toss_webhook_rate_limiter.check(
        client_rate_limit_key(request.url.path, request_client_ip(request))
    )
    payment_key = payload.payment_key_hint()
    invalid_keys = request.app.state.toss_invalid_payment_keys
    if payment_key is not None and invalid_keys.contains(payment_key):
        return WebhookResult(handled=False, reason="payment_not_found")

    result = await service.reconcile_from_webhook(session, request.app.state.toss, payment_key)
    if payment_key is not None and result.get("reason") == "payment_not_found":
        invalid_keys.add(payment_key)
    return WebhookResult(**result)
