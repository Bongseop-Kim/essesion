import { describe, expect, it } from "vitest";

import { bonusPercent } from "@/pages/token-purchase/index";

describe("bonusPercent", () => {
  it("가장 비싼 토큰당 단가를 기준선으로 보너스를 낸다", () => {
    const starter = { plan_key: "starter", price: 2500, token_amount: 2500 };
    const popular = { plan_key: "popular", price: 6500, token_amount: 7500 };
    const pro = { plan_key: "pro", price: 18000, token_amount: 25000 };
    const plans = [starter, popular, pro];

    // 기준선 = starter(1.00원/토큰). popular 0.867원 → +15%, pro 0.72원 → +39%
    expect(bonusPercent(starter, plans)).toBe(0);
    expect(bonusPercent(popular, plans)).toBe(15);
    expect(bonusPercent(pro, plans)).toBe(39);
  });
});
