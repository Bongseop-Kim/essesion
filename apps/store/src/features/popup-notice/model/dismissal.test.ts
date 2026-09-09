import { describe, expect, it } from "vitest";

import type { StorageLike } from "@/shared/lib/browser-storage";

import { dismissForToday, isDismissedToday, kstToday } from "./dismissal";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("popup dismissal", () => {
  it("같은 KST 날짜에는 숨기고 날짜가 바뀌면 다시 보인다", () => {
    const storage = memoryStorage();
    // KST 2026-09-09 23:30 = UTC 14:30
    const tonight = new Date("2026-09-09T14:30:00Z");
    const afterMidnight = new Date("2026-09-09T15:30:00Z"); // KST 다음날 00:30

    expect(isDismissedToday("p1", { storage, now: tonight })).toBe(false);
    expect(dismissForToday("p1", { storage, now: tonight })).toBe(true);
    expect(isDismissedToday("p1", { storage, now: tonight })).toBe(true);
    expect(isDismissedToday("p1", { storage, now: afterMidnight })).toBe(false);
    // 다른 팝업(새 공지)은 영향받지 않는다.
    expect(isDismissedToday("p2", { storage, now: tonight })).toBe(false);
  });

  it("KST 기준 날짜 문자열을 만든다", () => {
    expect(kstToday(new Date("2026-09-09T14:30:00Z"))).toBe("2026-09-09");
    expect(kstToday(new Date("2026-09-09T15:30:00Z"))).toBe("2026-09-10");
  });

  it("저장소가 없거나 막혀 있으면 항상 보인다", () => {
    expect(isDismissedToday("p1", { storage: null })).toBe(false);
    expect(dismissForToday("p1", { storage: null })).toBe(false);
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };
    expect(isDismissedToday("p1", { storage: blocked })).toBe(false);
    expect(dismissForToday("p1", { storage: blocked })).toBe(false);
  });
});
