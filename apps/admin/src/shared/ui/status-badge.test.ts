import { describe, expect, it } from "vitest";

import { claimBadge } from "./status-badge";

describe("admin claimBadge", () => {
  it("주문 상태와 무관하게 완료된 취소를 완료로 표시한다", () => {
    const claim = { claim_number: "CLM-1", type: "cancel", status: "완료" };

    expect(claimBadge(claim)).toEqual({
      label: "취소 완료",
      tone: "critical",
    });
  });

  it("토큰 환불과 거부 상태를 표시한다", () => {
    expect(
      claimBadge({
        claim_number: "TKR-1",
        type: "token_refund",
        status: "완료",
      }),
    ).toEqual({ label: "토큰 환불 완료", tone: "positive" });
    expect(
      claimBadge({ claim_number: "CLM-2", type: "exchange", status: "거부" }),
    ).toEqual({ label: "교환 거부", tone: "neutral" });
  });
});
