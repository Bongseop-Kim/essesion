import { describe, expect, it } from "vitest";

import { claimBadge } from "./config";

describe("claimBadge", () => {
  it("주문 상태와 무관하게 완료된 취소를 완료로 표시한다", () => {
    const claim = { claim_number: "CLM-1", type: "cancel", status: "완료" };

    expect(claimBadge(claim)).toEqual({
      label: "취소 완료",
      tone: "critical",
    });
  });

  it.each([
    ["return", "접수", "반품 진행중", "informative"],
    ["return", "완료", "반품 완료", "positive"],
    ["exchange", "재발송", "교환 진행중", "informative"],
    ["exchange", "완료", "교환 완료", "positive"],
    ["token_refund", "접수", "토큰 환불 처리중", "warning"],
    ["token_refund", "완료", "토큰 환불 완료", "positive"],
  ])("%s %s 표시를 계산한다", (type, status, label, tone) => {
    expect(claimBadge({ claim_number: "CLM-1", type, status })).toEqual({
      label,
      tone,
    });
  });

  it.each([
    ["cancel", "취소 거부"],
    ["return", "반품 거부"],
    ["exchange", "교환 거부"],
    ["token_refund", "토큰 환불 거부"],
  ])("%s 거부를 중립 상태로 표시한다", (type, label) => {
    expect(claimBadge({ claim_number: "CLM-1", type, status: "거부" })).toEqual(
      { label, tone: "neutral" },
    );
  });
});
