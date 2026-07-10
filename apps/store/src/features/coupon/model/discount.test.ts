import type { CouponOut } from "@essesion/api-client";
import { describe, expect, it } from "vitest";

import { couponDiscount } from "./discount";

const coupon = (values: Partial<CouponOut>): CouponOut =>
  ({
    id: "coupon",
    name: "test",
    display_name: null,
    discount_type: "fixed",
    discount_value: "1000",
    max_discount_amount: null,
    description: null,
    expiry_date: "2099-12-31",
    additional_info: null,
    is_active: true,
    ...values,
  }) as CouponOut;

describe("couponDiscount", () => {
  it("applies a fixed coupon once per line and caps percentage discounts", () => {
    expect(couponDiscount(coupon({ discount_value: "5000" }), 20_000)).toBe(
      5_000,
    );
    expect(
      couponDiscount(
        coupon({
          discount_type: "percentage",
          discount_value: "10",
          max_discount_amount: "2500",
        }),
        29_997,
      ),
    ).toBe(2_500);
  });
});
