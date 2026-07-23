import uuid
from datetime import date, datetime
from decimal import Decimal

from api.schemas import ORMModel


class CouponOut(ORMModel):
    id: uuid.UUID
    name: str
    display_name: str | None
    discount_type: str
    discount_value: Decimal
    max_discount_amount: Decimal | None
    description: str | None
    expiry_date: date
    additional_info: str | None
    is_active: bool


class UserCouponOut(ORMModel):
    id: uuid.UUID
    coupon_id: uuid.UUID
    status: str
    issued_at: datetime
    expires_at: datetime | None
    used_at: datetime | None
    coupon: CouponOut | None = None
