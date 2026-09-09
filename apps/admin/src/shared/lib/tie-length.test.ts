import { describe, expect, it } from "vitest";

import { recommendedTieLengthCm } from "./tie-length";

describe("recommendedTieLengthCm", () => {
  it("store 안내표(reform-service-guide.tsx HEIGHT_GUIDE)의 9개 행과 일치한다", () => {
    expect(recommendedTieLengthCm(150)).toBe(41);
    expect(recommendedTieLengthCm(155)).toBe(43);
    expect(recommendedTieLengthCm(160)).toBe(45);
    expect(recommendedTieLengthCm(165)).toBe(47);
    expect(recommendedTieLengthCm(170)).toBe(49);
    expect(recommendedTieLengthCm(175)).toBe(51);
    expect(recommendedTieLengthCm(180)).toBe(53);
    expect(recommendedTieLengthCm(185)).toBe(55);
    expect(recommendedTieLengthCm(190)).toBe(57);
  });
});
