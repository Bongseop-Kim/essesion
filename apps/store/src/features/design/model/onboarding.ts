import type { StorageLike } from "./pending";

export const DESIGN_ONBOARDING_KEY = "design:onboarding:v1";
const DESIGN_ONBOARDING_COMPLETE = "1";

type StorageOptions = {
  storage?: StorageLike | null;
};

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(storage: StorageLike | null | undefined) {
  return storage === undefined ? browserStorage() : storage;
}

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
