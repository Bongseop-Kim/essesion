import type { ReformPricingOut } from "@essesion/api-client";
import { describe, expect, it } from "vitest";

import { upsertReformCartItems } from "@/features/cart";
import {
  calculateReformCost,
  type ReformTieForm,
  reformDataFromForm,
  reformServiceLabel,
} from "./reform";

const pricing: ReformPricingOut = {
  automatic_cost: 16000,
  width_cost: 30000,
  restoration_cost: 30000,
  automatic_combined_cost: 40000,
  width_restoration_cost: 30000,
  shipping_cost: 4500,
  pickup_fee: 5000,
};

function tie(overrides: Partial<ReformTieForm> = {}): ReformTieForm {
  return {
    itemId: "reform:test",
    file: null,
    previewUrl: null,
    uploadedImage: { object_key: "uploads/reform_upload/tie.png" },
    automaticEnabled: false,
    mechanism: "",
    wearerHeightCm: null,
    dimple: false,
    turnKnot: false,
    widthEnabled: false,
    targetWidthCm: null,
    restorationEnabled: false,
    restorationMemo: "",
    ...overrides,
  };
}

describe("reform pricing and cart mapping", () => {
  it("matches every combined pricing branch", () => {
    expect(calculateReformCost(tie({ automaticEnabled: true }), pricing)).toBe(
      16000,
    );
    expect(calculateReformCost(tie({ widthEnabled: true }), pricing)).toBe(
      30000,
    );
    expect(
      calculateReformCost(tie({ restorationEnabled: true }), pricing),
    ).toBe(30000);
    expect(
      calculateReformCost(
        tie({ automaticEnabled: true, widthEnabled: true }),
        pricing,
      ),
    ).toBe(40000);
    expect(
      calculateReformCost(
        tie({ widthEnabled: true, restorationEnabled: true }),
        pricing,
      ),
    ).toBe(30000);
  });

  it("removes unsupported turn-knot from string automatic repair", () => {
    const data = reformDataFromForm(
      tie({
        automaticEnabled: true,
        mechanism: "string",
        wearerHeightCm: 175,
        dimple: true,
        turnKnot: true,
      }),
    );
    expect(data.tie.automatic?.turn_knot).toBe(false);
    expect(reformServiceLabel(data)).toBe(
      "자동 수선(끈 · 착용자 175cm · 딤플)",
    );
  });

  it("shows every selected reform option in the cart label", () => {
    const data = reformDataFromForm(
      tie({
        automaticEnabled: true,
        mechanism: "zipper",
        wearerHeightCm: 180,
        dimple: true,
        turnKnot: true,
        widthEnabled: true,
        targetWidthCm: 7.5,
        restorationEnabled: true,
        restorationMemo: "안감 복원 상담",
      }),
    );
    expect(reformServiceLabel(data)).toBe(
      "자동 수선(지퍼 · 착용자 180cm · 딤플 · 돌려묶기) · 폭 수선(희망 7.5cm) · 복원 수선(안감 복원 상담)",
    );
  });

  it("upserts one cart line per tie without changing another item", () => {
    const data = reformDataFromForm(
      tie({ restorationEnabled: true, restorationMemo: "복원" }),
    );
    const items = upsertReformCartItems(
      [
        {
          item_id: "product:1:base",
          item_type: "product",
          product_id: 1,
          quantity: 1,
        },
      ],
      [{ itemId: "reform:test", reformData: data }],
    );
    expect(items.map((item) => item.item_id)).toEqual([
      "product:1:base",
      "reform:test",
    ]);
  });

  it("replaces reform options in the same cart line", () => {
    const original = reformDataFromForm(
      tie({
        automaticEnabled: true,
        mechanism: "zipper",
        wearerHeightCm: 175,
      }),
    );
    const updated = reformDataFromForm(
      tie({ widthEnabled: true, targetWidthCm: 7.5 }),
    );
    const [item] = upsertReformCartItems(
      [
        {
          item_id: "reform:test",
          item_type: "reform",
          quantity: 1,
          reform_data: original,
          applied_user_coupon_id: "00000000-0000-0000-0000-000000000001",
        },
      ],
      [{ itemId: "reform:test", reformData: updated }],
    );

    expect(item?.item_id).toBe("reform:test");
    expect(item?.applied_user_coupon_id).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
    expect(item?.reform_data?.tie.image.object_key).toBe(
      "uploads/reform_upload/tie.png",
    );
    expect(item?.reform_data?.tie.automatic).toBeNull();
    expect(item?.reform_data?.tie.width?.target_width_cm).toBe(7.5);
  });
});
