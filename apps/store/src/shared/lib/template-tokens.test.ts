import { describe, expect, it } from "vitest";

import { applyTemplateTokens } from "./template-tokens";

describe("applyTemplateTokens", () => {
  it("known reform pricing tokens are replaced", () => {
    expect(
      applyTemplateTokens(
        "배송 {{REFORM_SHIPPING_COST}} / 수거 {{REFORM_PICKUP_FEE}}",
        {
          REFORM_SHIPPING_COST: "4,500",
          REFORM_PICKUP_FEE: "5,000",
        },
      ),
    ).toBe("배송 4,500 / 수거 5,000");
  });

  it("missing values fall back without hiding the document", () => {
    expect(applyTemplateTokens("배송비 {{REFORM_SHIPPING_COST}}원", {})).toBe(
      "배송비 —원",
    );
  });

  it("unknown placeholders are left untouched", () => {
    expect(applyTemplateTokens("{{UNKNOWN_PRICE}}", {})).toBe(
      "{{UNKNOWN_PRICE}}",
    );
  });
});
