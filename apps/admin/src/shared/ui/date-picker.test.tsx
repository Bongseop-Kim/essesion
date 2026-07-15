import { describe, expect, it } from "vitest";

import { monthGrid } from "./date-picker";

describe("monthGrid", () => {
  it("요일 오프셋만큼 null을 채우고 말일까지 ISO 문자열을 만든다", () => {
    const grid = monthGrid(2026, 7); // 2026-07-01은 수요일
    expect(grid.slice(0, 4)).toEqual([null, null, null, "2026-07-01"]);
    expect(grid[3 + 30]).toBe("2026-07-31");
    expect(grid.filter(Boolean)).toHaveLength(31);
  });

  it("윤년 2월을 처리한다", () => {
    expect(monthGrid(2024, 2).filter(Boolean)).toHaveLength(29);
    expect(monthGrid(2025, 2).filter(Boolean)).toHaveLength(28);
  });

  it("높이 고정을 위해 항상 6주(42칸)를 반환한다", () => {
    expect(monthGrid(2026, 7)).toHaveLength(42);
    expect(monthGrid(2026, 2)).toHaveLength(42); // 4주로 딱 떨어지는 달
    expect(monthGrid(2026, 8)).toHaveLength(42); // 6주에 걸치는 달
  });
});
