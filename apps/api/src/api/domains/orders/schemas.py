import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from api.domains.reform.schemas import ReformDataIn


class OrderItemIn(BaseModel):
    item_id: str
    item_type: Literal["product", "reform"]
    quantity: int
    product_id: int | None = None
    selected_option_id: str | None = None
    reform_data: ReformDataIn | None = None
    applied_user_coupon_id: uuid.UUID | None = None


class RepairPickupIn(BaseModel):
    recipient_name: str
    recipient_phone: str
    address: str
    postal_code: str | None = None
    detail_address: str | None = None


class RepairShippingIn(BaseModel):
    method: Literal["direct", "pickup"]
    pickup: RepairPickupIn | None = None


class OrderCreateRequest(BaseModel):
    shipping_address_id: uuid.UUID
    items: list[OrderItemIn]
    repair_shipping: RepairShippingIn | None = None


class CreatedOrder(BaseModel):
    order_id: uuid.UUID
    order_number: str
    order_type: str


class OrderCreateResponse(BaseModel):
    payment_group_id: uuid.UUID
    total_amount: int
    orders: list[CreatedOrder]


class CustomAmountRequest(BaseModel):
    options: dict[str, Any]
    quantity: int


class CustomAmountResponse(BaseModel):
    sewing_cost: int
    fabric_cost: int
    total_cost: int


class ReferenceImageIn(BaseModel):
    object_key: str  # GCS 서명 업로드로 올린 객체 키 (구 ImageKit url/fileId 대체)


class CustomOrderCreateRequest(BaseModel):
    shipping_address_id: uuid.UUID
    options: dict[str, Any]
    quantity: int
    reference_images: list[ReferenceImageIn] = []
    additional_notes: str = ""
    user_coupon_id: uuid.UUID | None = None


class SampleOrderCreateRequest(BaseModel):
    shipping_address_id: uuid.UUID
    sample_type: Literal["fabric", "sewing", "fabric_and_sewing"]
    options: dict[str, Any]
    reference_images: list[ReferenceImageIn] = []
    additional_notes: str = ""
    user_coupon_id: uuid.UUID | None = None


class SampleAmountRequest(BaseModel):
    sample_type: Literal["fabric", "sewing", "fabric_and_sewing"]
    options: dict[str, Any]


class SampleAmountResponse(BaseModel):
    total_cost: int


class SingleOrderCreateResponse(BaseModel):
    order_id: uuid.UUID
    order_number: str
    payment_group_id: uuid.UUID
    total_amount: int


class OrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    item_id: str
    item_type: str
    product_id: int | None
    selected_option_id: str | None
    item_data: dict[str, Any] | None
    quantity: int
    unit_price: int
    discount_amount: int
    line_discount_amount: int
    applied_user_coupon_id: uuid.UUID | None


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    order_number: str
    order_type: str
    status: str
    total_price: int
    original_price: int
    total_discount: int
    shipping_cost: int
    payment_group_id: uuid.UUID | None
    shipping_address_id: uuid.UUID | None
    courier_company: str | None
    tracking_number: str | None
    shipped_at: datetime | None
    delivered_at: datetime | None
    confirmed_at: datetime | None
    company_courier_company: str | None
    company_tracking_number: str | None
    company_shipped_at: datetime | None
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemOut] = []
    customer_actions: list[str] = []


class OrderShippingAddressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    recipient_name: str
    recipient_phone: str
    postal_code: str
    address: str
    address_detail: str | None
    delivery_memo: str | None
    delivery_request: str | None


class OrderDetailOut(OrderOut):
    shipping_address: OrderShippingAddressOut | None = None


class RepairPhotoIn(BaseModel):
    object_key: str


class RepairTrackingRequest(BaseModel):
    courier_company: str
    tracking_number: str
    memo: str | None = None
    photos: list[RepairPhotoIn] = []


class RepairNoTrackingRequest(BaseModel):
    # reason 없는 순수 "발송 확인" 허용 — 사유 강제는 폐기 (money.md §9)
    reason: Literal["quick", "overseas", "lost"] | None = None
    memo: str | None = None
    photos: list[RepairPhotoIn] = []


class AdminStatusUpdateRequest(BaseModel):
    new_status: str
    memo: str | None = None
    is_rollback: bool = False


class AdminStatusUpdateResponse(BaseModel):
    success: bool
    previous_status: str
    new_status: str


class AdminTrackingUpdateRequest(BaseModel):
    courier_company: str | None = None
    tracking_number: str | None = None
    company_courier_company: str | None = None
    company_tracking_number: str | None = None
