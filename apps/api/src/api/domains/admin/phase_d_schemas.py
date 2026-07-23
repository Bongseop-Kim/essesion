import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from api.domains.orders.schemas import (
    OrderItemOut,
    OrderShippingAddressOut,
    RepairPickupOut,
    RepairShippingReceiptOut,
)

ClaimTypeFilter = Literal["all", "cancel", "return", "exchange", "token_refund"]
ClaimStatusFilter = Literal[
    "all",
    "접수",
    "처리중",
    "수거요청",
    "수거완료",
    "재발송",
    "완료",
    "거부",
]
ClaimSort = Literal["created_at", "updated_at", "claim_number", "status"]
IncidentTypeFilter = Literal[
    "all", "confirm", "refund", "partial_cancel", "mixed_state", "amount_mismatch"
]
IncidentStatusFilter = Literal["all", "open", "resolved"]
IncidentSort = Literal["created_at", "updated_at", "status", "incident_type"]


class AdminClaimAction(BaseModel):
    kind: Literal["advance", "reject", "rollback", "approve_refund"]
    target_status: str | None = None
    label: str
    enabled: bool
    blocking_reason: str | None = None
    requires_memo: bool = False
    destructive: bool = False


class AdminClaimTrackingAction(BaseModel):
    kind: Literal["return", "resend"]
    label: str
    enabled: bool
    blocking_reason: str | None = None


class ClaimTrackingUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    operation_id: uuid.UUID
    kind: Literal["return", "resend"]
    courier_company: str = Field(min_length=1, max_length=50)
    tracking_number: str = Field(
        min_length=4,
        max_length=100,
        pattern=r"^[A-Za-z0-9-]+$",
    )
    memo: str = Field(min_length=3, max_length=500)


class AdminClaimCustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str | None
    phone: str | None


class AdminClaimSummaryOut(BaseModel):
    id: uuid.UUID
    claim_number: str
    type: str
    status: str
    reason: str
    quantity: int
    order_id: uuid.UUID
    order_number: str
    customer: AdminClaimCustomerOut
    created_at: datetime
    updated_at: datetime
    admin_actions: list[AdminClaimAction] = Field(default_factory=list)


class AdminClaimOrderOut(BaseModel):
    id: uuid.UUID
    order_number: str
    order_type: str
    status: str
    order_amount: int
    payment_group_id: uuid.UUID | None


class AdminClaimStatusLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    changed_by: uuid.UUID | None
    previous_status: str
    new_status: str
    memo: str | None
    is_rollback: bool
    request_id: str | None
    created_at: datetime


class ClaimNotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    delivery_status: Literal["pending", "sent", "failed", "skipped"]
    attempts: int
    last_error: str | None
    sent_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AdminClaimShippingOut(BaseModel):
    shipping_address: OrderShippingAddressOut | None
    order_courier_company: str | None
    order_tracking_number: str | None
    company_courier_company: str | None
    company_tracking_number: str | None
    return_courier_company: str | None
    return_tracking_number: str | None
    resend_courier_company: str | None
    resend_tracking_number: str | None
    repair_pickup: RepairPickupOut | None
    repair_receipts: list[RepairShippingReceiptOut] = Field(default_factory=list)


class AdminTimelineEvent(BaseModel):
    event_type: Literal[
        "claim_created",
        "claim_status",
        "claim_shipping",
        "order_status",
        "repair_shipping",
        "notification",
    ]
    created_at: datetime
    title: str
    description: str | None = None
    actor_id: uuid.UUID | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PaymentIncidentSummaryOut(BaseModel):
    id: uuid.UUID
    operation_id: str
    incident_type: str
    status: str
    request_id: str
    actor_id: uuid.UUID | None
    order_id: uuid.UUID | None
    claim_id: uuid.UUID | None
    expected_amount: int
    observed_amount: int | None
    resolved_by: uuid.UUID | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime


class IncidentAdminAction(BaseModel):
    kind: Literal["reconcile", "resolve"]
    label: str
    enabled: bool
    blocking_reason: str | None = None
    requires_memo: bool = False
    destructive: bool = False


class PaymentIncidentDetailOut(PaymentIncidentSummaryOut):
    details: dict[str, Any]
    resolution_memo: str | None
    order_number: str | None
    claim_number: str | None
    admin_actions: list[IncidentAdminAction] = Field(default_factory=list)


class AdminClaimDetailOut(AdminClaimSummaryOut):
    description: str | None
    refund_data: dict[str, Any] | None
    order: AdminClaimOrderOut
    item: OrderItemOut
    shipping: AdminClaimShippingOut
    tracking_actions: list[AdminClaimTrackingAction] = Field(default_factory=list)
    status_logs: list[AdminClaimStatusLogOut] = Field(default_factory=list)
    notifications: list[ClaimNotificationOut] = Field(default_factory=list)
    payment_incidents: list[PaymentIncidentSummaryOut] = Field(default_factory=list)
    timeline: list[AdminTimelineEvent] = Field(default_factory=list)


class IncidentResolveRequest(BaseModel):
    operation_id: uuid.UUID
    memo: str = Field(min_length=1, max_length=500)
