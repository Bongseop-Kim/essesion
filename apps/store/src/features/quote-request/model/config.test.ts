import { describe, expect, it } from "vitest";

import {
  formatQuoteAmount,
  quoteContactMethodLabel,
  quoteContactName,
  quoteRequestStatusTone,
} from "./config";

describe("quote request display config", () => {
  it("진행 상태를 의미에 맞는 배지 tone으로 바꾼다", () => {
    expect(quoteRequestStatusTone("요청")).toBe("neutral");
    expect(quoteRequestStatusTone("견적발송")).toBe("informative");
    expect(quoteRequestStatusTone("협의중")).toBe("warning");
    expect(quoteRequestStatusTone("확정")).toBe("positive");
    expect(quoteRequestStatusTone("종료")).toBe("critical");
    expect(quoteRequestStatusTone("알 수 없음")).toBe("neutral");
  });

  it("연락 방법과 상호명을 고객용 라벨로 표시한다", () => {
    expect(quoteContactMethodLabel("phone")).toBe("전화");
    expect(quoteContactMethodLabel("email")).toBe("이메일");
    expect(quoteContactMethodLabel("messenger")).toBe("기타");
    expect(quoteContactName("김영선", "ESSE SION")).toBe("김영선 · ESSE SION");
    expect(quoteContactName("김영선", "  ")).toBe("김영선");
  });

  it("견적 금액을 원화 표기로 만든다", () => {
    expect(formatQuoteAmount(1234567)).toBe("1,234,567원");
  });
});
