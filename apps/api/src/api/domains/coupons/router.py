"""내 쿠폰 조회 — 발급·회수는 admin 도메인."""

from db.models.commerce import Coupon, UserCoupon
from fastapi import APIRouter
from sqlalchemy import func, select

from api.db import SessionDep
from api.deps import CurrentUser
from api.domains.coupons.schemas import CouponOut, UserCouponOut

router = APIRouter(tags=["coupons"])


@router.get("/coupons/mine", response_model=list[UserCouponOut])
async def list_my_coupons(
    session: SessionDep, user: CurrentUser, active_only: bool = False
) -> list[UserCouponOut]:
    query = (
        select(UserCoupon, Coupon)
        .join(Coupon, Coupon.id == UserCoupon.coupon_id)
        .where(UserCoupon.user_id == user.id)
        .order_by(UserCoupon.issued_at.desc())
    )
    if active_only:
        query = query.where(
            UserCoupon.status == "active",
            (UserCoupon.expires_at.is_(None)) | (UserCoupon.expires_at > func.now()),
            Coupon.is_active.is_(True),
            Coupon.expiry_date >= func.current_date(),
        )
    rows = (await session.execute(query)).all()
    results = []
    for user_coupon, coupon in rows:
        out = UserCouponOut.model_validate(user_coupon)
        out.coupon = CouponOut.model_validate(coupon)
        results.append(out)
    return results
