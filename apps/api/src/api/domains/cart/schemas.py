import uuid
from typing import Literal

from pydantic import BaseModel

from api.domains.coupons.schemas import UserCouponOut
from api.domains.products.schemas import ProductOptionOut, ProductOut
from api.domains.reform.schemas import ReformDataIn, ReformDataOut


class CartItemIn(BaseModel):
    item_id: str  # 클라이언트 합성 키
    item_type: Literal["product", "reform"]
    quantity: int
    product_id: int | None = None
    selected_option_id: str | None = None
    reform_data: ReformDataIn | None = None
    applied_user_coupon_id: uuid.UUID | None = None


class CartReplaceRequest(BaseModel):
    items: list[CartItemIn]


class CartRemoveRequest(BaseModel):
    item_ids: list[str]


class CartItemOut(BaseModel):
    item_id: str
    item_type: str
    quantity: int
    product: ProductOut | None
    selected_option: ProductOptionOut | None
    reform_data: ReformDataOut | None
    applied_coupon: UserCouponOut | None
