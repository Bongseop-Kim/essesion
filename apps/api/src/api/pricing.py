"""pricing_constants / admin_settings 조회 헬퍼."""

from db.models.commerce import AdminSetting, PricingConstant
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.errors import DomainError


async def get_pricing_constants(session: AsyncSession, keys: list[str]) -> dict[str, int]:
    rows = await session.execute(
        select(PricingConstant.key, PricingConstant.amount).where(PricingConstant.key.in_(keys))
    )
    found: dict[str, int] = {key: amount for key, amount in rows.all()}
    for key in keys:
        if key not in found:
            raise DomainError(f"Missing pricing constant: {key}", code="pricing_not_configured")
    return found


async def get_admin_setting(session: AsyncSession, key: str) -> str | None:
    return await session.scalar(select(AdminSetting.value).where(AdminSetting.key == key))
