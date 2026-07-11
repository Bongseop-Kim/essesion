import { describe, expect, it } from "vitest";

import {
  completeDesignOnboarding,
  DESIGN_ONBOARDING_KEY,
  isDesignOnboardingComplete,
} from "./onboarding";
import type { StorageLike } from "./pending";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("design onboarding storage", () => {
  it("완료 여부를 저장하고 다시 읽는다", () => {
    const storage = memoryStorage();

    expect(isDesignOnboardingComplete({ storage })).toBe(false);
    expect(completeDesignOnboarding({ storage })).toBe(true);
    expect(isDesignOnboardingComplete({ storage })).toBe(true);
    expect(storage.getItem(DESIGN_ONBOARDING_KEY)).toBe("1");
  });

  it("다른 저장값은 완료로 취급하지 않는다", () => {
    const storage = memoryStorage();
    storage.setItem(DESIGN_ONBOARDING_KEY, "true");

    expect(isDesignOnboardingComplete({ storage })).toBe(false);
  });

  it("저장소가 없거나 접근할 수 없어도 예외를 전파하지 않는다", () => {
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

    expect(isDesignOnboardingComplete({ storage })).toBe(false);
    expect(completeDesignOnboarding({ storage })).toBe(false);
    expect(isDesignOnboardingComplete({ storage: null })).toBe(false);
    expect(completeDesignOnboarding({ storage: null })).toBe(false);
  });
});
