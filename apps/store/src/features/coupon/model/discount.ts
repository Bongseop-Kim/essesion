import type { CouponOut } from "@essesion/api-client";

export function couponLabel(coupon?: CouponOut | null) {
  if (!coupon) return "쿠폰";
  return coupon.display_name ?? coupon.name;
}

export function couponDiscount(
  coupon: CouponOut | null | undefined,
  lineAmount: number,
) {
  if (!coupon) return 0;
  const value = Number(coupon.discount_value);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const raw =
    coupon.discount_type === "percent" || coupon.discount_type === "percentage"
      ? Math.floor((lineAmount * value) / 100)
      : value;
  const max = coupon.max_discount_amount
    ? Number(coupon.max_discount_amount)
    : null;
  const capped = max && Number.isFinite(max) ? Math.min(raw, max) : raw;
  return Math.min(lineAmount, Math.max(0, capped));
}
