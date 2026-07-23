"""마이페이지 — 프로필(허용 필드만)·알림 설정(감사 로그)·배송지·탈퇴 (domains.md §2·§3·§6)."""

import uuid
from datetime import UTC, date, datetime

from db.models.auth import PhoneVerification, RefreshToken, UserIdentity
from db.models.commerce import (
    Claim,
    Inquiry,
    NotificationPreferenceLog,
    Order,
    QuoteRequest,
    ShippingAddress,
)
from db.models.design import DesignSession, GenerationJob
from db.models.tokens import DesignToken, TokenPurchase
from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import USER_LOCK, SessionDep, advisory_xact_lock
from api.deps import CurrentUser, ensure_owner, lock_active_user
from api.domains.auth.schemas import MeResponse
from api.schemas import ORMModel

router = APIRouter(tags=["users"])


class ProfileUpdateRequest(BaseModel):
    """본인 수정 허용 필드만 — 휴대폰/알림/role은 전용 경로."""

    name: str | None = None
    birth: date | None = None
    marketing_kakao_sms_consent: bool | None = None


class NotificationPreferencesRequest(BaseModel):
    notification_consent: bool | None = None
    notification_enabled: bool | None = None


class ShippingAddressIn(BaseModel):
    id: uuid.UUID | None = None  # 있으면 수정, 없으면 신규
    recipient_name: str
    recipient_phone: str
    postal_code: str
    address: str
    address_detail: str | None = None
    is_default: bool = False
    delivery_memo: str | None = None
    delivery_request: str | None = None


class ShippingAddressOut(ORMModel):
    id: uuid.UUID
    recipient_name: str
    recipient_phone: str
    postal_code: str
    address: str
    address_detail: str | None
    is_default: bool
    delivery_memo: str | None
    delivery_request: str | None
    created_at: datetime


@router.patch("/users/me", response_model=MeResponse)
async def update_profile(
    body: ProfileUpdateRequest, session: SessionDep, user: CurrentUser
) -> MeResponse:
    await lock_active_user(session, user)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await session.commit()
    await session.refresh(user)
    return MeResponse.model_validate(user)


@router.post("/users/me/notification-preferences", response_model=MeResponse)
async def set_notification_preferences(
    body: NotificationPreferencesRequest, session: SessionDep, user: CurrentUser
) -> MeResponse:
    await lock_active_user(session, user)
    next_consent = (
        body.notification_consent
        if body.notification_consent is not None
        else user.notification_consent
    )
    next_enabled = (
        body.notification_enabled
        if body.notification_enabled is not None
        else user.notification_enabled
    )
    changed = (next_consent, next_enabled) != (
        user.notification_consent,
        user.notification_enabled,
    )
    if changed:
        session.add(
            NotificationPreferenceLog(
                user_id=user.id,
                previous_notification_consent=user.notification_consent,
                new_notification_consent=next_consent,
                previous_notification_enabled=user.notification_enabled,
                new_notification_enabled=next_enabled,
            )
        )
        user.notification_consent = next_consent
        user.notification_enabled = next_enabled
    await session.commit()
    if changed:
        await session.refresh(user)
    return MeResponse.model_validate(user)


async def _has_history(session: AsyncSession, user_id: uuid.UUID) -> bool:
    return bool(
        await session.scalar(
            select(
                or_(
                    exists().where(Order.user_id == user_id),
                    exists().where(Claim.user_id == user_id),
                    exists().where(QuoteRequest.user_id == user_id),
                    exists().where(Inquiry.user_id == user_id),
                    # 초기 무료 지급 한 행만 있는 OAuth 사용자는 아래 hard-delete에서
                    # 원장을 함께 지운다. 그 외 토큰 원장과 디자인 세션·잡은 FK가
                    # NO ACTION이고 보존 정책도 미확정이므로 이력으로 취급한다.
                    exists().where(
                        DesignToken.user_id == user_id,
                        or_(
                            DesignToken.type != "grant",
                            DesignToken.token_class != "free",
                            DesignToken.description.is_distinct_from("신규 가입 토큰 지급"),
                            DesignToken.work_id.is_not(None),
                            DesignToken.source_order_id.is_not(None),
                        ),
                    ),
                    exists().where(TokenPurchase.user_id == user_id),
                    exists().where(DesignSession.user_id == user_id),
                    exists().where(GenerationJob.user_id == user_id),
                )
            )
        )
    )


@router.delete("/users/me", status_code=204)
async def delete_account(session: SessionDep, user: CurrentUser) -> None:
    """탈퇴 — 보존 이력 없으면 하드 삭제(CASCADE), 있으면 비활성화 + 개인정보 익명화.

    (구 delete-account는 auth.users 삭제 + 전체 CASCADE — 새 스키마는 주문·클레임
    이력이 NO ACTION이므로 이력 보존을 위해 소프트 처리. MAPPING.md §1)
    """
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user.id))
    if await _has_history(session, user.id):
        user.is_active = False
        user.email = None
        user.name = "탈퇴회원"
        user.phone = None
        user.phone_verified = False
        user.password_hash = None
        user.birth = None
        user.deleted_at = datetime.now(UTC)
        await session.execute(delete(UserIdentity).where(UserIdentity.user_id == user.id))
        await session.execute(delete(ShippingAddress).where(ShippingAddress.user_id == user.id))
        await session.execute(delete(PhoneVerification).where(PhoneVerification.user_id == user.id))

        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=func.now())
        )
        await session.commit()
    else:
        # OAuth 가입 트리거의 초기 무료 지급은 사용자 소유 비거래 데이터다. 이력
        # 판정이 다른 토큰 행을 모두 걸러냈으므로 user FK를 지우기 전에 함께 제거한다.
        await session.execute(delete(DesignToken).where(DesignToken.user_id == user.id))
        await session.delete(user)
        await session.commit()


# ---- 배송지 ----


@router.get("/users/me/addresses", response_model=list[ShippingAddressOut])
async def list_addresses(session: SessionDep, user: CurrentUser) -> list[ShippingAddressOut]:
    rows = await session.scalars(
        select(ShippingAddress)
        .where(ShippingAddress.user_id == user.id)
        .order_by(ShippingAddress.is_default.desc(), ShippingAddress.created_at.desc())
    )
    return [ShippingAddressOut.model_validate(a) for a in rows]


@router.put("/users/me/addresses", response_model=ShippingAddressOut)
async def upsert_address(
    body: ShippingAddressIn, session: SessionDep, user: CurrentUser
) -> ShippingAddressOut:
    await lock_active_user(session, user)

    if body.id is not None:
        address = await session.get(ShippingAddress, body.id)
        ensure_owner(address, user)
        assert address is not None
        for field, value in body.model_dump(exclude={"id"}).items():
            setattr(address, field, value)
    else:
        address = ShippingAddress(user_id=user.id, **body.model_dump(exclude={"id"}))
        session.add(address)
        await session.flush()

    if body.is_default:  # 기본 배송지 배타 처리
        await session.execute(
            update(ShippingAddress)
            .where(ShippingAddress.user_id == user.id, ShippingAddress.id != address.id)
            .values(is_default=False)
        )
    await session.commit()
    await session.refresh(address)
    return ShippingAddressOut.model_validate(address)


@router.delete("/users/me/addresses/{address_id}", status_code=204)
async def delete_address(address_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    await lock_active_user(session, user)
    address = await session.get(ShippingAddress, address_id)
    ensure_owner(address, user)
    await session.delete(address)
    await session.commit()
