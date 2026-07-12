import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TokenLedgerType = Literal["grant", "use", "refund", "admin", "purchase"]
TokenHistoryFilter = Literal["credit", "use", "refund"]


class TokenBalance(BaseModel):
    total: int
    paid: int
    bonus: int  # bonus + free
    generate_cost: int


class TokenPlan(BaseModel):
    plan_key: str
    price: int
    token_amount: int


class TokenHistoryEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    amount: int
    type: TokenLedgerType
    token_class: Literal["paid", "bonus", "free"]
    description: str | None
    source_order_id: uuid.UUID | None
    expires_at: datetime | None
    created_at: datetime


class TokenOrderCreateRequest(BaseModel):
    plan_key: Literal["starter", "popular", "pro"]


class TokenOrderCreateResponse(BaseModel):
    order_id: uuid.UUID
    order_number: str
    payment_group_id: uuid.UUID
    price: int
    token_amount: int


class RefundableTokenOrder(BaseModel):
    order_id: uuid.UUID
    order_number: str
    total_price: int
    paid_tokens_granted: int
    token_expires_at: datetime | None
    is_refundable: bool
    reason: str | None  # expired | pending_refund | approved_refund | not_latest | tokens_used
    claim_id: uuid.UUID | None


class TokenRefundRequestIn(BaseModel):
    order_id: uuid.UUID


class TokenRefundRequestOut(BaseModel):
    claim_id: uuid.UUID
    claim_number: str
    refund_amount: int
    paid_token_amount: int
    bonus_token_amount: int


class AdminTokenManageRequest(BaseModel):
    operation_id: uuid.UUID
    user_id: uuid.UUID
    amount: int  # 양수 지급 / 음수 회수
    description: str = Field(min_length=3, max_length=500)


class AdminTokenManageResponse(BaseModel):
    success: bool
    new_balance: int
    operation_id: uuid.UUID
