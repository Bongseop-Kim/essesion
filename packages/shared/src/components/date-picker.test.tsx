import { describe, expect, it } from "vitest";

import { monthGrid } from "./date-picker";

describe("monthGrid", () => {
  it("요일 오프셋만큼 null을 채우고 말일까지 ISO 문자열을 만든다", () => {
    const grid = monthGrid(2026, 7);
    expect(grid.slice(0, 4)).toEqual([null, null, null, "2026-07-01"]);
    expect(grid[3 + 30]).toBe("2026-07-31");
    expect(grid.filter(Boolean)).toHaveLength(31);
  });

  it("윤년과 고정된 6주 높이를 처리한다", () => {
    expect(monthGrid(2024, 2).filter(Boolean)).toHaveLength(29);
    expect(monthGrid(2025, 2).filter(Boolean)).toHaveLength(28);
    expect(monthGrid(2026, 2)).toHaveLength(42);
    expect(monthGrid(2026, 8)).toHaveLength(42);
  });
});
