import { describe, expect, it } from "vitest";

import {
  clearPendingDesign,
  DESIGN_PENDING_KEY,
  DESIGN_PENDING_TTL_MS,
  parsePendingDesign,
  readPendingDesign,
  type StorageLike,
  writePendingDesign,
} from "./pending";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("design pending storage", () => {
  it("pending을 저장하고 읽고 제거한다", () => {
    const storage = memoryStorage();

    expect(writePendingDesign("session-1", { storage, now: 100 })).toBe(true);
    expect(readPendingDesign({ storage, now: 200 })).toEqual({
      sessionId: "session-1",
      at: 100,
    });

    clearPendingDesign({ storage });
    expect(readPendingDesign({ storage, now: 200 })).toBeNull();
  });

  it("24시간이 된 pending을 만료시키고 저장소에서 제거한다", () => {
    const storage = memoryStorage();
    writePendingDesign("session-1", { storage, now: 1_000 });

    expect(
      readPendingDesign({ storage, now: 1_000 + DESIGN_PENDING_TTL_MS }),
    ).toBeNull();
    expect(storage.getItem(DESIGN_PENDING_KEY)).toBeNull();
  });

  it("24시간 전까지는 유효하고 잘못된 값은 무시한다", () => {
    const raw = JSON.stringify({ sessionId: "session-1", at: 1_000 });

    expect(parsePendingDesign(raw, 1_000 + DESIGN_PENDING_TTL_MS - 1)).toEqual({
      sessionId: "session-1",
      at: 1_000,
    });
    expect(parsePendingDesign("not-json", 1_000)).toBeNull();
    expect(
      parsePendingDesign(JSON.stringify({ sessionId: "", at: 1_000 }), 1_000),
    ).toBeNull();
  });

  it("저장소 접근 실패를 호출자에게 전파하지 않는다", () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readPendingDesign({ storage })).toBeNull();
    expect(writePendingDesign("session-1", { storage })).toBe(false);
    expect(() => clearPendingDesign({ storage })).not.toThrow();
    expect(readPendingDesign({ storage: null })).toBeNull();
  });
});
