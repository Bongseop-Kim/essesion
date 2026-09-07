import { resolveStorage, type StorageLike } from "@/shared/lib/browser-storage";

// 코치마크 도입(2026-09)으로 키를 바꿨다 — 옛 키 이관 없음: 기존 사용자도 새 안내를 한 번 본다.
export const DESIGN_ONBOARDING_KEY = "design:coachmark:v1";
const DESIGN_ONBOARDING_COMPLETE = "1";

type StorageOptions = {
  storage?: StorageLike | null;
};

export function isDesignOnboardingComplete(
  options: StorageOptions = {},
): boolean {
  const storage = resolveStorage(options.storage);
  if (!storage) return false;

  try {
    return (
      storage.getItem(DESIGN_ONBOARDING_KEY) === DESIGN_ONBOARDING_COMPLETE
    );
  } catch {
    return false;
  }
}

export function completeDesignOnboarding(
  options: StorageOptions = {},
): boolean {
  const storage = resolveStorage(options.storage);
  if (!storage) return false;

  try {
    storage.setItem(DESIGN_ONBOARDING_KEY, DESIGN_ONBOARDING_COMPLETE);
    return true;
  } catch {
    return false;
  }
}
