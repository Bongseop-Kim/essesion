import uuid
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from db.models.commerce import ShippingAddress
from sqlalchemy.ext.asyncio import AsyncSession

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


async def resolve_shipping_address(
    session: AsyncSession,
    snapshot: dict[str, Any] | None,
    address_id: uuid.UUID | None,
) -> OrderShippingAddressOut | None:
    if snapshot:
        return OrderShippingAddressOut.model_validate(snapshot)
    if address_id is None:
        return None
    address = await session.get(ShippingAddress, address_id)
    return OrderShippingAddressOut.model_validate(address) if address is not None else None
