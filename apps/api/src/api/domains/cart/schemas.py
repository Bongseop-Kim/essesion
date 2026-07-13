import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator

from api.domains.coupons.schemas import UserCouponOut
from api.domains.products.schemas import ProductOptionOut, ProductOut
from api.domains.reform.schemas import ReformDataIn, ReformDataOut

MAX_CART_ITEMS = 50
MAX_CART_QUANTITY = 10_000
MAX_CART_ITEM_ID_LENGTH = 200
MAX_OPTION_ID_LENGTH = 64
CartItemId = Annotated[str, Field(min_length=1, max_length=MAX_CART_ITEM_ID_LENGTH)]


class CartItemIn(BaseModel):
    item_id: CartItemId  # 클라이언트 합성 키
    item_type: Literal["product", "reform"]
    quantity: int = Field(le=MAX_CART_QUANTITY)
    product_id: int | None = None
    selected_option_id: str | None = Field(default=None, max_length=MAX_OPTION_ID_LENGTH)
    reform_data: ReformDataIn | None = None
    applied_user_coupon_id: uuid.UUID | None = None


class CartReplaceRequest(BaseModel):
    items: list[CartItemIn] = Field(max_length=MAX_CART_ITEMS)

    @field_validator("items")
    @classmethod
    def reject_duplicate_item_ids(cls, value: list[CartItemIn]) -> list[CartItemIn]:
        item_ids = [item.item_id for item in value]
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("item_id must be unique within the cart")
        return value


class CartRemoveRequest(BaseModel):
    item_ids: list[CartItemId] = Field(max_length=MAX_CART_ITEMS)

    @field_validator("item_ids")
    @classmethod
    def reject_duplicate_item_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("item_id must be unique within the removal request")
        return value


class CartItemOut(BaseModel):
    item_id: str
    item_type: str
    quantity: int
    product: ProductOut | None
    selected_option_id: str | None
    selected_option: ProductOptionOut | None
    reform_data: ReformDataOut | None
    applied_coupon: UserCouponOut | None
    availability: Literal["available", "unavailable"]
    blocking_reason: str | None = None
