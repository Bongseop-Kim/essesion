import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from api.domains.orders.schemas import OrderItemOut
from api.schemas import ORMModel

ClaimType = Literal["cancel", "return", "exchange"]
ClaimReason = Literal[
    "change_mind", "defect", "delay", "wrong_item", "size_mismatch", "color_mismatch", "other"
]


class ClaimCreateRequest(BaseModel):
    type: ClaimType
    order_id: uuid.UUID
    item_id: str  # order_items.item_id (클라이언트 합성 키)
    reason: ClaimReason
    description: str | None = None
    quantity: int | None = None  # 기본 = 아이템 수량


class ClaimOut(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    order_id: uuid.UUID
    order_item_id: uuid.UUID
    order_number: str
    item: OrderItemOut
    claim_number: str
    type: str
    status: str
    reason: str
    description: str | None
    quantity: int
    return_courier_company: str | None
    return_tracking_number: str | None
    resend_courier_company: str | None
    resend_tracking_number: str | None
    refund_data: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime


class AdminClaimStatusRequest(BaseModel):
    new_status: str
    memo: str | None = None
    is_rollback: bool = False
    # 취소 클레임을 처리중으로 올릴 때만 받는다. 생략하면 주문 금액 전액.
    refund_amount: int | None = None


class AdminClaimStatusResponse(BaseModel):
    success: bool
    previous_status: str
    new_status: str
