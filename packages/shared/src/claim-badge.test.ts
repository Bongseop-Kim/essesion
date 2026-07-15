import { describe, expect, it } from "vitest";

import { claimBadge } from "./claim-badge";

describe("claimBadge", () => {
  it.each([
    ["cancel", "완료", "취소 완료", "critical"],
    ["cancel", "접수", "취소 처리중", "warning"],
    ["return", "처리중", "반품 진행중", "informative"],
    ["exchange", "완료", "교환 완료", "positive"],
    ["token_refund", "접수", "토큰 환불 처리중", "warning"],
    ["token_refund", "완료", "토큰 환불 완료", "positive"],
  ])("%s %s 표시를 계산한다", (type, status, label, tone) => {
    expect(claimBadge({ type, status })).toEqual({ label, tone });
  });

  it.each([
    ["cancel", "취소 거부"],
    ["return", "반품 거부"],
    ["exchange", "교환 거부"],
    ["token_refund", "토큰 환불 거부"],
  ])("%s 거부를 중립 상태로 표시한다", (type, label) => {
    expect(claimBadge({ type, status: "거부" })).toEqual({
      label,
      tone: "neutral",
    });
  });
});
