"""가격·전역 설정의 allowlist 조회와 원자적 stale-safe 저장."""

import uuid
from collections.abc import Collection
from datetime import UTC, datetime
from typing import Literal, cast

from db.models.commerce import AdminSetting, PricingConstant
from fastapi import APIRouter
from obs import request_id_var
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select

from api.db import SessionDep
from api.deps import AdminOnly, AdminUser
from api.domains.admin.operations import idempotent_result, record_operation
from api.domains.design.quota import parse_finalize_limit
from api.errors import ConflictError, DomainError

router = APIRouter(prefix="/admin", tags=["admin-configuration"])

PRICE_CATEGORIES: dict[str, str] = {
    "REFORM_AUTOMATIC_COST": "reform",
    "REFORM_WIDTH_COST": "reform",
    "REFORM_RESTORATION_COST": "reform",
    "REFORM_AUTOMATIC_COMBINED_COST": "reform",
    "REFORM_WIDTH_RESTORATION_COST": "reform",
    "REFORM_SHIPPING_COST": "reform",
    "REFORM_PICKUP_FEE": "reform",
    "START_COST": "custom_order",
    "SEWING_PER_COST": "custom_order",
    "AUTO_TIE_COST": "custom_order",
    "TRIANGLE_STITCH_COST": "custom_order",
    "SIDE_STITCH_COST": "custom_order",
    "BAR_TACK_COST": "custom_order",
    "DIMPLE_COST": "custom_order",
    "SPODERATO_COST": "custom_order",
    "FOLD7_COST": "custom_order",
    "WOOL_INTERLINING_COST": "custom_order",
    "BRAND_LABEL_COST": "custom_order",
    "CARE_LABEL_COST": "custom_order",
    "YARN_DYED_DESIGN_COST": "custom_order",
    "FABRIC_PRINTING_POLY": "fabric",
    "FABRIC_PRINTING_SILK": "fabric",
    "FABRIC_YARN_DYED_POLY": "fabric",
    "FABRIC_YARN_DYED_SILK": "fabric",
    "SAMPLE_SEWING_COST": "custom_order",
    "SAMPLE_FABRIC_PRINTING_COST": "custom_order",
    "SAMPLE_FABRIC_YARN_DYED_COST": "custom_order",
    "SAMPLE_FABRIC_AND_SEWING_PRINTING_COST": "custom_order",
    "SAMPLE_FABRIC_AND_SEWING_YARN_DYED_COST": "custom_order",
    "sample_discount_sewing": "sample_discount",
    "sample_discount_fabric_printing": "sample_discount",
    "sample_discount_fabric_yarn_dyed": "sample_discount",
    "sample_discount_fabric_and_sewing_printing": "sample_discount",
    "sample_discount_fabric_and_sewing_yarn_dyed": "sample_discount",
    "token_plan_starter_price": "token",
    "token_plan_starter_amount": "token",
    "token_plan_popular_price": "token",
    "token_plan_popular_amount": "token",
    "token_plan_pro_price": "token",
    "token_plan_pro_amount": "token",
}
SETTING_KEYS = (
    "default_courier_company",
    "design_finalize_daily_limit",
    "design_token_initial_grant",
)
SettingKey = Literal[
    "default_courier_company",
    "design_finalize_daily_limit",
    "design_token_initial_grant",
]


class PricingValueOut(BaseModel):
    key: str
    amount: int
    category: str
    unit: Literal["원", "개"]
    description: str
    updated_at: datetime
    updated_by: uuid.UUID | None


class PricingUpdateItem(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    amount: int = Field(ge=0, le=1_000_000_000)
    expected_updated_at: AwareDatetime


class PricingUpdateRequest(BaseModel):
    operation_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=500)
    items: list[PricingUpdateItem] = Field(min_length=1, max_length=len(PRICE_CATEGORIES))


class AdminSettingOut(BaseModel):
    key: SettingKey
    value: str
    value_type: Literal["courier", "non_negative_integer"]
    updated_at: datetime
    updated_by: uuid.UUID | None


class SettingUpdateItem(BaseModel):
    key: SettingKey
    value: str = Field(max_length=100)
    expected_updated_at: AwareDatetime


class SettingsUpdateRequest(BaseModel):
    operation_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=500)
    items: list[SettingUpdateItem] = Field(min_length=1, max_length=len(SETTING_KEYS))


def _missing(keys: Collection[str], *, resource: str) -> None:
    if keys:
        raise DomainError(
            f"필수 {resource} 설정이 없습니다: {', '.join(sorted(keys))}",
            code="missing_configuration",
            status=503,
        )


def _price_out(row: PricingConstant) -> PricingValueOut:
    is_token_amount = row.key.startswith("token_plan_") and row.key.endswith("_amount")
    return PricingValueOut(
        key=row.key,
        amount=row.amount,
        category=row.category,
        unit="개" if is_token_amount else "원",
        description=row.key,
        updated_at=row.updated_at,
        updated_by=row.updated_by,
    )


async def _pricing_rows(session, *, lock: bool = False) -> list[PricingConstant]:
    query = select(PricingConstant).where(PricingConstant.key.in_(PRICE_CATEGORIES))
    if lock:
        query = query.with_for_update()
    rows = list(
        await session.scalars(query.order_by(PricingConstant.category, PricingConstant.key))
    )
    _missing(set(PRICE_CATEGORIES) - {row.key for row in rows}, resource="가격")
    return rows


@router.get("/pricing", response_model=list[PricingValueOut])
async def get_admin_pricing(session: SessionDep, admin: AdminUser) -> list[PricingValueOut]:
    return [_price_out(row) for row in await _pricing_rows(session)]


@router.put("/pricing", response_model=list[PricingValueOut])
async def update_admin_pricing(
    body: PricingUpdateRequest, session: SessionDep, admin: AdminOnly
) -> list[PricingValueOut]:
    keys = [item.key for item in body.items]
    if len(keys) != len(set(keys)):
        raise DomainError("가격 key가 중복되었습니다", code="duplicate_key", status=422)
    unknown = set(keys) - set(PRICE_CATEGORIES)
    if unknown:
        raise DomainError(
            f"허용되지 않은 가격 key입니다: {', '.join(sorted(unknown))}",
            code="unknown_pricing_key",
            status=422,
        )
    payload = body.model_dump(mode="json", exclude={"operation_id"})
    previous = await idempotent_result(
        session,
        operation_id=body.operation_id,
        action="pricing_update",
        target_type="pricing",
        target_id=None,
        payload=payload,
    )
    if previous is not None:
        return [_price_out(row) for row in await _pricing_rows(session)]

    requested = {item.key: item for item in body.items}
    rows = await _pricing_rows(session, lock=True)
    by_key = {row.key: row for row in rows}
    for key, item in requested.items():
        row = by_key[key]
        if row.updated_at.astimezone(UTC) != item.expected_updated_at.astimezone(UTC):
            raise ConflictError(
                f"{key} 가격이 다른 관리자에 의해 변경되었습니다",
                code="stale_resource",
            )
        if row.category != PRICE_CATEGORIES[key]:
            raise DomainError(
                f"{key} 가격 category가 올바르지 않습니다",
                code="invalid_configuration",
                status=503,
            )
    before = {key: by_key[key].amount for key in requested}
    for key, item in requested.items():
        by_key[key].amount = item.amount
        by_key[key].updated_by = admin.id
    after = {"values": {key: item.amount for key, item in requested.items()}}
    record_operation(
        session,
        operation_id=body.operation_id,
        actor_id=admin.id,
        action="pricing_update",
        target_type="pricing",
        target_id=None,
        target_count=len(requested),
        reason=body.reason,
        payload=payload,
        before=before,
        after=after,
        request_id=request_id_var.get(),
    )
    await session.commit()
    return [_price_out(row) for row in await _pricing_rows(session)]


def _validate_setting(key: str, value: str) -> str:
    clean = value.strip()
    if key == "default_courier_company":
        if not clean:
            raise DomainError("기본 택배사를 입력해 주세요", code="invalid_setting", status=422)
        return clean
    if key == "design_finalize_daily_limit":
        limit = parse_finalize_limit(clean)
        if limit is None:
            raise DomainError(
                "실사화 24시간 한도는 0에서 1000 사이 정수여야 합니다",
                code="invalid_setting",
                status=422,
            )
        return str(limit)
    if not clean.isdigit() or not 0 <= int(clean) <= 100_000:
        raise DomainError(
            "신규 사용자 초기 토큰은 0에서 100000 사이 정수여야 합니다",
            code="invalid_setting",
            status=422,
        )
    return str(int(clean))


def _setting_out(row: AdminSetting) -> AdminSettingOut:
    if row.value is None:
        raise DomainError(
            f"필수 설정 값이 없습니다: {row.key}",
            code="missing_configuration",
            status=503,
        )
    return AdminSettingOut(
        key=cast("SettingKey", row.key),
        value=row.value,
        value_type=("courier" if row.key == "default_courier_company" else "non_negative_integer"),
        updated_at=row.updated_at,
        updated_by=row.updated_by,
    )


async def _setting_rows(session, *, lock: bool = False) -> list[AdminSetting]:
    query = select(AdminSetting).where(AdminSetting.key.in_(SETTING_KEYS))
    if lock:
        query = query.with_for_update()
    rows = list(await session.scalars(query.order_by(AdminSetting.key)))
    _missing(set(SETTING_KEYS) - {row.key for row in rows}, resource="관리자")
    return rows


@router.get("/settings", response_model=list[AdminSettingOut])
async def get_admin_settings(session: SessionDep, admin: AdminUser) -> list[AdminSettingOut]:
    return [_setting_out(row) for row in await _setting_rows(session)]


@router.put("/settings", response_model=list[AdminSettingOut])
async def update_admin_settings(
    body: SettingsUpdateRequest, session: SessionDep, admin: AdminOnly
) -> list[AdminSettingOut]:
    keys = [item.key for item in body.items]
    if len(keys) != len(set(keys)):
        raise DomainError("설정 key가 중복되었습니다", code="duplicate_key", status=422)
    payload = body.model_dump(mode="json", exclude={"operation_id"})
    previous = await idempotent_result(
        session,
        operation_id=body.operation_id,
        action="settings_update",
        target_type="settings",
        target_id=None,
        payload=payload,
    )
    if previous is not None:
        return [_setting_out(row) for row in await _setting_rows(session)]

    requested = {item.key: item for item in body.items}
    rows = await _setting_rows(session, lock=True)
    by_key = {row.key: row for row in rows}
    normalized: dict[str, str] = {}
    for key, item in requested.items():
        row = by_key[key]
        if row.updated_at.astimezone(UTC) != item.expected_updated_at.astimezone(UTC):
            raise ConflictError(
                f"{key} 설정이 다른 관리자에 의해 변경되었습니다",
                code="stale_resource",
            )
        normalized[key] = _validate_setting(key, item.value)
    before = {key: by_key[key].value for key in requested}
    for key, value in normalized.items():
        by_key[key].value = value
        by_key[key].updated_by = admin.id
    after = {"values": normalized}
    record_operation(
        session,
        operation_id=body.operation_id,
        actor_id=admin.id,
        action="settings_update",
        target_type="settings",
        target_id=None,
        target_count=len(requested),
        reason=body.reason,
        payload=payload,
        before=before,
        after=after,
        request_id=request_id_var.get(),
    )
    await session.commit()
    return [_setting_out(row) for row in await _setting_rows(session)]
