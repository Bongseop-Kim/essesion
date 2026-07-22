import type { OrderItemOut } from "@essesion/api-client";
import { describe, expect, it } from "vitest";

import { claimItemTitle } from "./config";

function item(overrides: Partial<OrderItemOut> = {}): OrderItemOut {
  return {
    applied_user_coupon_id: null,
    discount_amount: 0,
    id: "item-1",
    item_data: {},
    item_id: "product:1",
    item_type: "product",
    line_discount_amount: 0,
    product_id: 1,
    quantity: 1,
    selected_option_id: null,
    unit_price: 41000,
    ...overrides,
  };
}

describe("claimItemTitle", () => {
  it("주문 시점 스냅샷의 상품명과 옵션명을 우선 표시한다", () => {
    expect(
      claimItemTitle(
        item({
          item_data: {
            product: { id: 1, name: "실크 넥타이" },
            option: { id: "opt-1", name: "와이드 8cm" },
          },
        }),
      ),
    ).toBe("실크 넥타이 (와이드 8cm)");
  });

  it("옵션 없는 스냅샷은 상품명만 표시한다", () => {
    expect(
      claimItemTitle(
        item({
          item_data: { product: { id: 1, name: "실크 넥타이" }, option: null },
        }),
      ),
    ).toBe("실크 넥타이");
  });

  it("스냅샷 없는 레거시 항목은 상품 번호로 폴백한다", () => {
    expect(claimItemTitle(item())).toBe("상품 #1");
    expect(claimItemTitle(item({ product_id: null }))).toBe("상품");
  });

  it("상품 외 타입은 고정 라벨을 유지한다", () => {
    expect(claimItemTitle(item({ item_type: "reform" }))).toBe("넥타이 수선");
    expect(claimItemTitle(item({ item_type: "token" }))).toBe("디자인 토큰");
  });
});
