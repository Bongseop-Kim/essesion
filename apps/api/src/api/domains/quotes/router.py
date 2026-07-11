import uuid

from db.models.commerce import QuoteRequest
from fastapi import APIRouter, BackgroundTasks, Request
from sqlalchemy import select

from api.db import SessionDep
from api.deps import AdminUser, CurrentUser, ensure_owner
from api.domains.quotes import service
from api.domains.quotes.schemas import (
    AdminQuoteStatusRequest,
    AdminQuoteStatusResponse,
    QuoteCreateRequest,
    QuoteOut,
)

router = APIRouter(tags=["quotes"])

QUOTE_RECEIVED_FALLBACK = (
    "[ESSE SION] 견적 요청이 접수되었습니다.\n담당자가 순차적으로 연락드리겠습니다."
)


@router.post("/quotes", response_model=QuoteOut, status_code=201)
async def create_quote(
    body: QuoteCreateRequest,
    session: SessionDep,
    user: CurrentUser,
    request: Request,
    background: BackgroundTasks,
) -> QuoteOut:
    quote = await service.create_quote(session, user, body, request.app.state.gcs)

    if (
        user.notification_consent
        and user.phone_verified
        and user.notification_enabled
        and user.phone
    ):
        app = request.app
        phone = user.phone

        async def _notify() -> None:
            await app.state.solapi.send_alimtalk(
                phone,
                app.state.settings.solapi_template_quote_received,
                {},
                QUOTE_RECEIVED_FALLBACK,
            )

        background.add_task(_notify)
    return QuoteOut.model_validate(quote)


@router.get("/quotes", response_model=list[QuoteOut])
async def list_my_quotes(session: SessionDep, user: CurrentUser) -> list[QuoteOut]:
    quotes = await session.scalars(
        select(QuoteRequest)
        .where(QuoteRequest.user_id == user.id)
        .order_by(QuoteRequest.created_at.desc())
    )
    return [QuoteOut.model_validate(q) for q in quotes]


@router.get("/quotes/{quote_id}", response_model=QuoteOut)
async def get_quote(quote_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> QuoteOut:
    quote = await session.get(QuoteRequest, quote_id)
    ensure_owner(quote, user)
    return QuoteOut.model_validate(quote)


# ---- 관리자 ----


@router.get("/admin/quotes", response_model=list[QuoteOut])
async def admin_list_quotes(session: SessionDep, admin: AdminUser) -> list[QuoteOut]:
    quotes = await session.scalars(select(QuoteRequest).order_by(QuoteRequest.created_at.desc()))
    return [QuoteOut.model_validate(q) for q in quotes]


@router.post("/admin/quotes/{quote_id}/status", response_model=AdminQuoteStatusResponse)
async def admin_update_quote_status(
    quote_id: uuid.UUID, body: AdminQuoteStatusRequest, session: SessionDep, admin: AdminUser
) -> AdminQuoteStatusResponse:
    result = await service.admin_update_status(
        session,
        admin,
        quote_id,
        new_status=body.new_status,
        quoted_amount=body.quoted_amount,
        quote_conditions=body.quote_conditions,
        admin_memo=body.admin_memo,
        memo=body.memo,
    )
    return AdminQuoteStatusResponse(**result)
