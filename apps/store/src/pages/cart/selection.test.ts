import { describe, expect, it } from "vitest";

import { reconcileCartSelection } from "./selection";

describe("reconcileCartSelection", () => {
  it("preserves the empty selection reference when the cart is empty", () => {
    const current: string[] = [];

    expect(reconcileCartSelection(current, [], false)).toBe(current);
  });

  it("selects every item once and removes ids that leave the cart", () => {
    const initialized = reconcileCartSelection([], ["first", "second"], false);
    expect(initialized).toEqual(["first", "second"]);

    expect(reconcileCartSelection(initialized, ["second"], true)).toEqual([
      "second",
    ]);
  });
});
