import uuid

from pydantic import BaseModel, ConfigDict, Field

TOSS_PAYMENT_KEY_MAX_LENGTH = 200


class PaymentConfirmRequest(BaseModel):
    payment_key: str = Field(min_length=1, max_length=TOSS_PAYMENT_KEY_MAX_LENGTH)
    payment_group_id: uuid.UUID  # Toss orderId로 사용되는 결제 그룹
    amount: int = Field(ge=1)


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


class TossWebhookData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    payment_key: str | None = Field(
        default=None,
        alias="paymentKey",
        min_length=1,
        max_length=TOSS_PAYMENT_KEY_MAX_LENGTH,
    )


class TossWebhookRequest(BaseModel):
    """Toss 웹훅에서 신뢰하지 않는 paymentKey 힌트만 경계에서 제한한다."""

    model_config = ConfigDict(populate_by_name=True)

    data: TossWebhookData | None = None
    payment_key: str | None = Field(
        default=None,
        alias="paymentKey",
        min_length=1,
        max_length=TOSS_PAYMENT_KEY_MAX_LENGTH,
    )

    def payment_key_hint(self) -> str | None:
        return self.data.payment_key if self.data is not None else self.payment_key


class WebhookResult(BaseModel):
    handled: bool
    action: str | None = None  # already_consistent | confirmed | canceled
    reason: str | None = None
    orders: int | None = None
