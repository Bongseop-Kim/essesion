import { describe, expect, it } from "vitest";

import { inquiryFormSchema, inquiryRequestFromForm } from "./form";

describe("inquiry form", () => {
  it("rejects blank copy and requires a product for product inquiries", () => {
    expect(
      inquiryFormSchema.safeParse({
        category: "일반",
        title: "   ",
        content: "내용",
        product_id: null,
      }).success,
    ).toBe(false);
    expect(
      inquiryFormSchema.safeParse({
        category: "상품",
        title: "상품 문의",
        content: "내용",
        product_id: null,
      }).success,
    ).toBe(false);
  });

  it("trims copy and clears a product from non-product requests", () => {
    expect(
      inquiryRequestFromForm({
        category: "수선",
        title: "  수선 문의  ",
        content: "  수선이 가능한가요?  ",
        product_id: 12,
      }),
    ).toEqual({
      category: "수선",
      title: "수선 문의",
      content: "수선이 가능한가요?",
      product_id: null,
    });
  });
});
