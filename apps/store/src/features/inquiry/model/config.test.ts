import type { InquiryOut } from "@essesion/api-client";
import { describe, expect, it } from "vitest";

import {
  isInquiryEditable,
  parseInquiryPrefill,
  summarizeInquiries,
} from "./config";

function inquiry(
  status: string,
  answerDate: string | null,
): Pick<InquiryOut, "answer_date" | "status"> {
  return { status, answer_date: answerDate };
}

describe("inquiry config", () => {
  it("supports both product query spellings and infers the product category", () => {
    expect(parseInquiryPrefill(new URLSearchParams("productId=12"))).toEqual({
      category: "상품",
      productId: 12,
    });
    expect(
      parseInquiryPrefill(new URLSearchParams("category=상품&product_id=34")),
    ).toEqual({ category: "상품", productId: 34 });
  });

  it("ignores invalid and irrelevant product ids", () => {
    expect(parseInquiryPrefill(new URLSearchParams("product_id=invalid"))).toBe(
      null,
    );
    expect(
      parseInquiryPrefill(new URLSearchParams("category=수선&product_id=12")),
    ).toEqual({ category: "수선", productId: null });
  });

  it("summarizes statuses and uses the latest answer date", () => {
    expect(
      summarizeInquiries([
        inquiry("답변대기", null),
        inquiry("답변완료", "2026-07-01T00:00:00Z"),
        inquiry("답변완료", "2026-07-10T00:00:00Z"),
      ]),
    ).toEqual({
      total: 3,
      waiting: 1,
      answered: 2,
      latestAnswerDate: "2026-07-10T00:00:00Z",
    });
    expect(isInquiryEditable("답변대기")).toBe(true);
    expect(isInquiryEditable("답변완료")).toBe(false);
  });
});
