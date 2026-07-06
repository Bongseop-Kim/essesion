import uuid

from pydantic import BaseModel


class PaymentConfirmRequest(BaseModel):
    payment_key: str
    payment_group_id: uuid.UUID  # Toss orderId로 사용되는 결제 그룹
    amount: int


class ConfirmedOrder(BaseModel):
    order_id: uuid.UUID
    order_number: str
    order_type: str
    status: str
    token_amount: int | None = None
    coupon_issued: bool = False


class PaymentConfirmResponse(BaseModel):
    success: bool = True
    orders: list[ConfirmedOrder]
    token_amount: int | None = None
