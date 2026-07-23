import { describe, expect, it } from "vitest";

import {
  AUTO_PATTERN_CONSTRAINTS,
  normalizeHexColor,
  normalizePaletteColors,
  patternConstraintLabels,
} from "./draft";

describe("design draft contracts", () => {
  it("#RGB와 #RRGGBB를 대문자 6자리로 정규화한다", () => {
    expect(normalizeHexColor(" #a3f ")).toBe("#AA33FF");
    expect(normalizeHexColor("11aaCC")).toBe("#11AACC");
    expect(normalizeHexColor("#12GG00")).toBeNull();
  });

  it("팔레트 순서를 유지하면서 중복을 제거한다", () => {
    expect(normalizePaletteColors(["#abc", "#AABBCC", "#123456"])).toEqual([
      "#AABBCC",
      "#123456",
    ]);
  });

  it("자동 패턴과 사용자 요약을 구분한다", () => {
    expect(
      patternConstraintLabels({
        ...AUTO_PATTERN_CONSTRAINTS,
        density: "dense",
        arrangement: "staggered",
      }),
    ).toEqual(["촘촘하게", "엇갈림"]);
  });
});
