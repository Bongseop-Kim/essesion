import type { UserCouponOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  HStack,
  ProgressCircle,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
} from "@essesion/shared";
import { useEffect, useState } from "react";

import { krw } from "@/shared/lib/format";
import { couponLabel } from "../model/discount";

const NONE_COUPON = "__none__";

export function CouponSelectModal({
  coupons,
  selected,
  loading,
  error,
  open,
  onOpenChange,
  onApply,
}: {
  coupons: UserCouponOut[];
  selected: UserCouponOut | null;
  loading: boolean;
  error: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (coupon: UserCouponOut | null) => Promise<void>;
}) {
  const [selectedCouponId, setSelectedCouponId] = useState(NONE_COUPON);

  useEffect(() => {
    setSelectedCouponId(selected?.id ?? NONE_COUPON);
  }, [selected]);

  const selectedCoupon =
    selectedCouponId === NONE_COUPON
      ? null
      : (coupons.find((coupon) => coupon.id === selectedCouponId) ?? null);

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="쿠폰 선택"
      size="medium"
      footer={
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Box>
          <Box
            as={ActionButton}
            type="button"
            width="full"
            disabled={loading || error}
            onClick={() => void onApply(selectedCoupon)}
          >
            적용
          </Box>
        </HStack>
      }
    >
      {loading ? (
        <HStack justify="center" py="x6">
          <ProgressCircle />
        </HStack>
      ) : error ? (
        <ContentPlaceholder
          title="쿠폰을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
        />
      ) : (
        <SelectBox
          value={selectedCouponId}
          onValueChange={(value) => setSelectedCouponId(String(value))}
          aria-label="쿠폰"
        >
          <SelectBoxItem value={NONE_COUPON} label="쿠폰 사용 안 함" />
          {coupons.map((coupon) => (
            <SelectBoxItem
              key={coupon.id}
              value={coupon.id}
              label={couponLabel(coupon.coupon)}
              description={couponDescription(coupon)}
            />
          ))}
        </SelectBox>
      )}
    </ResponsiveModal>
  );
}

function couponDescription(coupon: UserCouponOut) {
  const discount = coupon.coupon
    ? formatDiscount(coupon.coupon.discount_type, coupon.coupon.discount_value)
    : null;
  const expires = coupon.expires_at
    ? `만료 ${new Intl.DateTimeFormat("ko-KR").format(new Date(coupon.expires_at))}`
    : null;
  return [discount, expires].filter(Boolean).join(" · ") || undefined;
}

function formatDiscount(type: string, value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (type === "percent" || type === "percentage") return `${n}% 할인`;
  return `₩${krw.format(n)} 할인`;
}
