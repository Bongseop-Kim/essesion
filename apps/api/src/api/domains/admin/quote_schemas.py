import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, Field

from api.domains.admin.schemas import AdminOrderCustomerOut
from api.domains.orders.schemas import OrderShippingAddressOut

QuoteStatus = Literal["요청", "견적발송", "협의중", "확정", "종료"]
QuoteStatusFilter = Literal["all", "요청", "견적발송", "협의중", "확정", "종료"]
QuoteSort = Literal["created_at", "updated_at", "quote_number", "status", "quoted_amount"]


class AdminQuoteAction(BaseModel):
    kind: Literal["transition"] = "transition"
    target_status: QuoteStatus
    label: str
    enabled: bool
    blocking_reason: str | None = None
    requires_memo: bool = False
    destructive: bool = False


class AdminQuoteSummaryOut(BaseModel):
    id: uuid.UUID
    quote_number: str
    status: str
    quantity: int
    business_name: str
    quoted_amount: int | None
    created_at: datetime
    updated_at: datetime
    customer: AdminOrderCustomerOut
    admin_actions: list[AdminQuoteAction] = Field(default_factory=list)


class AdminQuoteImageOut(BaseModel):
    id: uuid.UUID
    content_type: str | None
    size_bytes: int | None
    created_at: datetime


class AdminQuoteActorOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str | None


class AdminQuoteStatusLogOut(BaseModel):
    id: uuid.UUID
    changed_by: uuid.UUID | None
    previous_status: str
    new_status: str
    memo: str | None
    request_id: str | None
    created_at: datetime
    actor: AdminQuoteActorOut | None


class AdminQuoteDetailOut(AdminQuoteSummaryOut):
    shipping_address_id: uuid.UUID | None
    shipping_address: OrderShippingAddressOut | None
    options: dict[str, Any]
    additional_notes: str
    contact_name: str
    contact_method: str
    contact_value: str
    quote_conditions: str | None
    admin_memo: str | None
    images: list[AdminQuoteImageOut] = Field(default_factory=list)
    status_logs: list[AdminQuoteStatusLogOut] = Field(default_factory=list)


class AdminQuoteStatusRequest(BaseModel):
    expected_updated_at: AwareDatetime
    new_status: QuoteStatus
    quoted_amount: int | None = Field(default=None, ge=0)
    quote_conditions: str | None = Field(default=None, max_length=5000)
    admin_memo: str | None = Field(default=None, max_length=5000)
    memo: str | None = Field(default=None, max_length=500)


class SignedReadUrlOut(BaseModel):
    read_url: str
