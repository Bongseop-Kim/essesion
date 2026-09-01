import uuid
from datetime import date, datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field

from api.domains.orders.schemas import (
    ClaimBadgeOut,
    OrderItemOut,
    OrderShippingAddressOut,
    RepairShippingReceiptOut,
)
from api.schemas import ORMModel

OrderTypeFilter = Literal["all", "sale", "custom", "repair", "token", "sample"]
# 대시보드 전용 — "manual"은 Order.order_type이 아니라 manual_orders 테이블을 가리킨다.
# 수기 주문은 Order 파이프라인과 무관한 별도 장부라, 주문 목록 필터(OrderTypeFilter)에는
# 넣지 않고 집계에서만 유형처럼 취급한다 (docs/api-spec/domains.md §10).
DashboardOrderTypeFilter = Literal["all", "sale", "custom", "repair", "token", "sample", "manual"]
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


class AdminOrderCustomerOut(ORMModel):
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
    claim_summary: ClaimBadgeOut | None = None


class DashboardSummaryOut(BaseModel):
    start_date: date
    end_date: date
    order_type: DashboardOrderTypeFilter
    order_count: int
    order_amount: int
    open_claim_count: int
    unanswered_inquiry_count: int
    open_payment_incident_count: int
    as_of: datetime


class DashboardRecentOrdersPage(Page[AdminOrderSummaryOut]):
    as_of: datetime


class DashboardTimeseriesPointOut(BaseModel):
    day: date
    order_count: int
    order_amount: int
    # 유형별 매출 — 7종의 합은 항상 order_amount와 같다(대시보드 스택 막대의 구획).
    # manual_*는 orders가 아닌 수기 장부이고, 품목에 주문제작 스펙이 하나라도 있으면
    # manual_custom으로 센다(수기 주문은 금액이 주문 단위라 품목 배분 근거가 없다).
    sale_amount: int
    custom_amount: int
    repair_amount: int
    sample_amount: int
    token_amount: int
    manual_custom_amount: int
    manual_repair_amount: int
    new_customer_count: int
    generation_total: int
    generation_failed: int
    token_consumed: int
    token_sold: int


class DashboardTimeseriesOut(BaseModel):
    start_date: date
    end_date: date
    order_type: DashboardOrderTypeFilter
    points: list[DashboardTimeseriesPointOut]
    as_of: datetime


class DashboardTopProductOut(BaseModel):
    product_id: int
    name: str
    quantity: int
    amount: int


class DashboardTopProductsOut(BaseModel):
    start_date: date
    end_date: date
    items: list[DashboardTopProductOut]
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


class AdminOrderStatusLogOut(ORMModel):
    id: uuid.UUID
    changed_by: uuid.UUID | None
    previous_status: str
    new_status: str
    memo: str | None
    is_rollback: bool
    created_at: datetime


class AdminActiveClaimOut(ORMModel):
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
    # 품목별로 올린 사진이다 — 어느 품목 것인지 알려야 상세가 품목 안에 그릴 수 있다.
    # 매칭에 실패한 과거 데이터는 None으로 남는다(상세가 품목 밖에 따로 노출).
    order_item_id: uuid.UUID | None = None
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
    repair_receipts: list[RepairShippingReceiptOut] = Field(default_factory=list)
