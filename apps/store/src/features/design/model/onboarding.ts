import { resolveStorage, type StorageLike } from "@/shared/lib/browser-storage";

export const DESIGN_ONBOARDING_KEY = "design:onboarding:v1";
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
