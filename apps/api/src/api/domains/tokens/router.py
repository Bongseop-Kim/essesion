import uuid

from fastapi import APIRouter, Request

from api.db import SessionDep
from api.deps import AdminUser, CurrentUser
from api.domains.tokens import ledger
from api.domains.tokens.schemas import (
    AdminTokenManageRequest,
    AdminTokenManageResponse,
    RefundableTokenOrder,
    TokenBalance,
    TokenOrderCreateRequest,
    TokenOrderCreateResponse,
    TokenPlan,
    TokenRefundRequestIn,
    TokenRefundRequestOut,
)

router = APIRouter(tags=["tokens"])


@router.get("/tokens/balance", response_model=TokenBalance)
async def get_token_balance(session: SessionDep, user: CurrentUser) -> TokenBalance:
    return TokenBalance(
        **await ledger.get_balance(session, user.id),
        generate_cost=await ledger.get_generate_cost(session),
    )


@router.get("/tokens/plans", response_model=list[TokenPlan])
async def get_token_plans(session: SessionDep) -> list[TokenPlan]:
    return [TokenPlan(**plan) for plan in await ledger.get_plans(session)]


@router.post("/tokens/orders", response_model=TokenOrderCreateResponse, status_code=201)
async def create_token_order(
    body: TokenOrderCreateRequest, session: SessionDep, user: CurrentUser
) -> TokenOrderCreateResponse:
    return TokenOrderCreateResponse(**await ledger.create_token_order(session, user, body.plan_key))


@router.get("/tokens/refundable-orders", response_model=list[RefundableTokenOrder])
async def list_refundable_token_orders(
    session: SessionDep, user: CurrentUser
) -> list[RefundableTokenOrder]:
    return [
        RefundableTokenOrder(**row) for row in await ledger.list_refundable_orders(session, user.id)
    ]


@router.post("/tokens/refund-requests", response_model=TokenRefundRequestOut, status_code=201)
async def request_token_refund(
    body: TokenRefundRequestIn, session: SessionDep, user: CurrentUser
) -> TokenRefundRequestOut:
    return TokenRefundRequestOut(**await ledger.request_refund(session, user, body.order_id))


@router.post("/tokens/refund-requests/{claim_id}/cancel", status_code=204)
async def cancel_token_refund(claim_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    await ledger.cancel_refund_request(session, user, claim_id)


# ---- 관리자 ----


@router.post("/admin/tokens/manage", response_model=AdminTokenManageResponse)
async def admin_manage_tokens(
    body: AdminTokenManageRequest, session: SessionDep, admin: AdminUser
) -> AdminTokenManageResponse:
    result = await ledger.admin_manage(session, body.user_id, body.amount, body.description)
    return AdminTokenManageResponse(**result)


@router.post("/admin/token-refunds/{claim_id}/approve")
async def admin_approve_token_refund(
    claim_id: uuid.UUID, session: SessionDep, admin: AdminUser, request: Request
) -> dict:
    return await ledger.approve_refund(session, admin, request.app.state.toss, claim_id)
