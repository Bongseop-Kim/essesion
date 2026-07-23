from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from api.domains.orders.schemas import OrderShippingAddressOut
from api.errors import DomainError

KST = ZoneInfo("Asia/Seoul")


def kst_day_bounds(
    start_date: date | None, end_date: date | None
) -> tuple[datetime | None, datetime | None]:
    if start_date is not None and end_date is not None and start_date > end_date:
        raise DomainError("start_date must be before end_date", code="invalid_range")
    start_at = (
        datetime.combine(start_date, time.min, tzinfo=KST) if start_date is not None else None
    )
    end_at = (
        datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=KST)
        if end_date is not None
        else None
    )
    return start_at, end_at


def resolve_shipping_address(snapshot: dict[str, Any] | None) -> OrderShippingAddressOut | None:
    return OrderShippingAddressOut.model_validate(snapshot) if snapshot is not None else None
