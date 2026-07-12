import uuid
from datetime import date, datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from api.domains.orders.schemas import OrderItemOut, OrderShippingAddressOut

OrderTypeFilter = Literal["all", "sale", "custom", "repair", "token", "sample"]
OrderStatusFilter = Literal[
    "all",
    "대기중",
    "결제중",
    "진행중",
    "배송중",
    "배송완료",
    "완료",
    "취소",
    "실패",
    "접수",
    "제작중",
    "제작완료",
    "수선중",
    "수선완료",
    "발송대기",
    "발송중",
    "발송확인중",
    "수거예정",
]
OrderSort = Literal["created_at", "updated_at", "order_number", "order_amount", "status"]
SortDirection = Literal["asc", "desc"]

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class AdminAction(BaseModel):
    kind: Literal["advance", "rollback", "cancel", "update_tracking"]
    target_status: str | None = None
    label: str
    enabled: bool
    blocking_reason: str | None = None
    requires_memo: bool = False
    destructive: bool = False


class AdminOrderCustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None
    name: str
    phone: str | None


class AdminOrderSummaryOut(BaseModel):
    id: uuid.UUID
    order_number: str
    order_type: str
    status: str
    order_amount: int
    payment_group_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    customer: AdminOrderCustomerOut
    admin_actions: list[AdminAction] = Field(default_factory=list)


class DashboardSummaryOut(BaseModel):
    start_date: date
    end_date: date
    order_type: OrderTypeFilter
    order_count: int
    order_amount: int
    open_claim_count: int
    unanswered_inquiry_count: int
    open_payment_incident_count: int
    as_of: datetime


class DashboardRecentOrdersPage(Page[AdminOrderSummaryOut]):
    as_of: datetime


class DashboardRecentQuoteOut(BaseModel):
    id: uuid.UUID
    quote_number: str
    status: str
    quoted_amount: int | None
    customer: AdminOrderCustomerOut
    business_name: str
    created_at: datetime


class DashboardRecentQuotesPage(Page[DashboardRecentQuoteOut]):
    as_of: datetime


class AdminOrderStatusLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    changed_by: uuid.UUID | None
    previous_status: str
    new_status: str
    memo: str | None
    is_rollback: bool
    created_at: datetime


class AdminActiveClaimOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    claim_number: str
    type: str
    status: str
    reason: str
    description: str | None
    quantity: int
    created_at: datetime


class AdminRelatedOrderOut(BaseModel):
    id: uuid.UUID
    order_number: str
    order_type: str
    status: str
    order_amount: int
    created_at: datetime


class AdminOrderReferenceImageOut(BaseModel):
    id: uuid.UUID
    content_type: str | None
    size_bytes: int | None
    created_at: datetime


class AdminOrderDetailOut(AdminOrderSummaryOut):
    original_price: int
    total_discount: int
    shipping_cost: int
    shipping_address_id: uuid.UUID | None
    shipping_address: OrderShippingAddressOut | None
    courier_company: str | None
    tracking_number: str | None
    shipped_at: datetime | None
    delivered_at: datetime | None
    confirmed_at: datetime | None
    company_courier_company: str | None
    company_tracking_number: str | None
    company_shipped_at: datetime | None
    items: list[OrderItemOut] = Field(default_factory=list)
    status_logs: list[AdminOrderStatusLogOut] = Field(default_factory=list)
    active_claim: AdminActiveClaimOut | None = None
    related_orders: list[AdminRelatedOrderOut] = Field(default_factory=list)
