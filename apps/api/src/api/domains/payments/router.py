from fastapi import APIRouter, Request

from api.db import SessionDep
from api.deps import CurrentUser
from api.domains.payments import service
from api.domains.payments.schemas import PaymentConfirmRequest, PaymentConfirmResponse

router = APIRouter(tags=["payments"])


@router.post("/payments/confirm", response_model=PaymentConfirmResponse)
async def confirm_payment(
    body: PaymentConfirmRequest, session: SessionDep, user: CurrentUser, request: Request
) -> PaymentConfirmResponse:
    return await service.confirm_payment(session, user, request.app.state.toss, body)
