import json
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

from api.domains.reform.schemas import ReformDataIn

MAX_ORDER_ITEMS = 50
MAX_ORDER_QUANTITY = 10_000
MAX_ITEM_ID_LENGTH = 200
MAX_OPTION_ID_LENGTH = 64
MAX_OPTIONS_BYTES = 10_000
MAX_ADDITIONAL_NOTES_LENGTH = 500
MAX_REFERENCE_IMAGES = 5
MAX_OBJECT_KEY_LENGTH = 1_024


def _validate_options_payload(value: dict[str, Any]) -> dict[str, Any]:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise ValueError("options must be finite JSON") from exc
    if len(encoded) > MAX_OPTIONS_BYTES:
        raise ValueError(f"options must be at most {MAX_OPTIONS_BYTES} bytes")
    return value


OptionsPayload = Annotated[dict[str, Any], AfterValidator(_validate_options_payload)]
ItemId = Annotated[str, Field(min_length=1, max_length=MAX_ITEM_ID_LENGTH)]


class OrderItemIn(BaseModel):
    item_id: ItemId
    item_type: Literal["product", "reform"]
    quantity: int = Field(le=MAX_ORDER_QUANTITY)
    product_id: int | None = None
    selected_option_id: str | None = Field(default=None, max_length=MAX_OPTION_ID_LENGTH)
    reform_data: ReformDataIn | None = None
    applied_user_coupon_id: uuid.UUID | None = None


class RepairPickupIn(BaseModel):
    recipient_name: str = Field(max_length=100)
    recipient_phone: str = Field(max_length=32)
    address: str = Field(max_length=500)
    postal_code: str | None = Field(default=None, max_length=20)
    detail_address: str | None = Field(default=None, max_length=500)


class RepairShippingIn(BaseModel):
    method: Literal["direct", "pickup"]
    pickup: RepairPickupIn | None = None


class OrderCreateRequest(BaseModel):
    shipping_address_id: uuid.UUID
    items: list[OrderItemIn] = Field(max_length=MAX_ORDER_ITEMS)
    repair_shipping: RepairShippingIn | None = None

    @field_validator("items")
    @classmethod
    def reject_duplicate_item_ids(cls, value: list[OrderItemIn]) -> list[OrderItemIn]:
        item_ids = [item.item_id for item in value]
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("item_id must be unique within an order")
        return value


class CreatedOrder(BaseModel):
    order_id: uuid.UUID
    order_number: str
    order_type: str


class OrderCreateResponse(BaseModel):
    payment_group_id: uuid.UUID
    total_amount: int
    orders: list[CreatedOrder]


class CustomAmountRequest(BaseModel):
    options: OptionsPayload
    quantity: int = Field(le=MAX_ORDER_QUANTITY)


class CustomAmountResponse(BaseModel):
    sewing_cost: int
    fabric_cost: int
    total_cost: int


class ReferenceImageIn(BaseModel):
    object_key: str = Field(
        min_length=1,
        max_length=MAX_OBJECT_KEY_LENGTH,
    )  # GCS 서명 업로드로 올린 객체 키 (구 ImageKit url/fileId 대체)


class OrderReferenceImageIn(BaseModel):
    upload_id: uuid.UUID


class CustomOrderCreateRequest(BaseModel):
    shipping_address_id: uuid.UUID
    options: OptionsPayload
    quantity: int = Field(le=MAX_ORDER_QUANTITY)
    reference_images: list[OrderReferenceImageIn] = Field(
        default_factory=list, max_length=MAX_REFERENCE_IMAGES
    )
    additional_notes: str = Field(default="", max_length=MAX_ADDITIONAL_NOTES_LENGTH)
    user_coupon_id: uuid.UUID | None = None


class SampleOrderCreateRequest(BaseModel):
    shipping_address_id: uuid.UUID
    sample_type: Literal["fabric", "sewing", "fabric_and_sewing"]
    options: OptionsPayload
    reference_images: list[OrderReferenceImageIn] = Field(
        default_factory=list, max_length=MAX_REFERENCE_IMAGES
    )
    additional_notes: str = Field(default="", max_length=MAX_ADDITIONAL_NOTES_LENGTH)
    user_coupon_id: uuid.UUID | None = None


class SampleAmountRequest(BaseModel):
    sample_type: Literal["fabric", "sewing", "fabric_and_sewing"]
    options: OptionsPayload


class SampleAmountResponse(BaseModel):
    total_cost: int


class SingleOrderCreateResponse(BaseModel):
    order_id: uuid.UUID
    order_number: str
    payment_group_id: uuid.UUID
    total_amount: int


class ClaimBadgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    claim_number: str
    type: str
    status: str


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
    claim: ClaimBadgeOut | None = None
    review_id: uuid.UUID | None = None


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
    claim_summary: ClaimBadgeOut | None = None
    review_id: uuid.UUID | None = None


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


class RepairPickupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    recipient_name: str
    recipient_phone: str
    postal_code: str | None
    address: str
    detail_address: str | None
    pickup_fee: int
    created_at: datetime


class RepairShippingReceiptOut(BaseModel):
    id: uuid.UUID
    receipt_type: str
    reason: str | None
    memo: str | None
    photo_count: int
    created_at: datetime


class OrderReferenceImageOut(BaseModel):
    id: uuid.UUID
    content_type: str | None
    size_bytes: int | None
    created_at: datetime


class OrderImageReadUrlOut(BaseModel):
    read_url: str


class OrderDetailOut(OrderOut):
    shipping_address: OrderShippingAddressOut | None = None
    repair_pickup: RepairPickupOut | None = None
    repair_receipts: list[RepairShippingReceiptOut] = Field(default_factory=list)


class RepairPhotoIn(BaseModel):
    object_key: str = Field(min_length=1, max_length=MAX_OBJECT_KEY_LENGTH)


class RepairTrackingRequest(BaseModel):
    courier_company: str = Field(max_length=30)
    tracking_number: str = Field(max_length=100)
    memo: str | None = Field(default=None, max_length=500)
    photos: list[RepairPhotoIn] = Field(default_factory=list, max_length=3)


class RepairNoTrackingRequest(BaseModel):
    # reason 없는 순수 "발송 확인" 허용 — 사유 강제는 폐기 (money.md §9)
    reason: Literal["quick", "overseas", "lost"] | None = None
    memo: str | None = Field(default=None, max_length=500)
    photos: list[RepairPhotoIn] = Field(default_factory=list, max_length=3)


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
