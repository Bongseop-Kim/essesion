import { describe, expect, it } from "vitest";

import { emblemBox } from "./tie-canvas";

const tip = {
  anchor: "bottom-right",
  x: 0.85,
  y: 0.585,
  size: 0.13,
  maxW: 0.26,
  maxH: 0.2,
} as const;

describe("emblemBox", () => {
  it("비율이 달라도 면적은 같고 오른쪽 아래 모서리는 고정이다", () => {
    const wide = emblemBox(tip, { x: 0, y: 0, width: 2, height: 1 }, 1);
    const tall = emblemBox(tip, { x: 0, y: 0, width: 1, height: 2 }, 1);
    for (const box of [wide, tall]) {
      expect(box.width * box.height).toBeCloseTo(0.13 * 0.13);
      expect(box.left + box.width).toBeCloseTo(0.85);
      expect(box.top + box.height).toBeCloseTo(0.585);
    }
    expect(wide.width).toBeGreaterThan(tall.width);
  });

  it("너무 길쭉한 로고는 최대 폭에서 멈춘다", () => {
    const banner = emblemBox(tip, { x: 0, y: 0, width: 10, height: 1 }, 1);
    expect(banner.width).toBeCloseTo(0.26);
  });

  it("center는 중심을 붙이고 높이는 아트 높이 비로 바꾼다", () => {
    const box = emblemBox(
      { ...tip, anchor: "center", x: 0.5, y: 0.5 },
      { x: 0, y: 0, width: 1, height: 1 },
      0.5,
    );
    expect(box.left + box.width / 2).toBeCloseTo(0.5);
    expect(box.height).toBeCloseTo(0.13 * 0.5);
    expect(box.top + box.height / 2).toBeCloseTo(0.5);
  });
});
