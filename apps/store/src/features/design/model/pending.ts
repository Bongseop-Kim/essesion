export const DESIGN_PENDING_KEY = "design:pending";
export const DESIGN_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export type DesignPending = {
  sessionId: string;
  at: number;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StorageOptions = {
  storage?: StorageLike | null;
  now?: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parsePendingDesign(
  raw: string | null,
  now = Date.now(),
): DesignPending | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return null;
    if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
      return null;
    }
    if (typeof value.at !== "number" || !Number.isFinite(value.at)) {
      return null;
    }
    if (now - value.at >= DESIGN_PENDING_TTL_MS) return null;
    return { sessionId: value.sessionId, at: value.at };
  } catch {
    return null;
  }
}

export function readPendingDesign(
  options: StorageOptions = {},
): DesignPending | null {
  const storage = resolveStorage(options.storage);
  if (!storage) return null;

  try {
    const raw = storage.getItem(DESIGN_PENDING_KEY);
    const pending = parsePendingDesign(raw, options.now);
    if (raw && !pending) storage.removeItem(DESIGN_PENDING_KEY);
    return pending;
  } catch {
    return null;
  }
}

export function writePendingDesign(
  sessionId: string,
  options: StorageOptions = {},
): boolean {
  const storage = resolveStorage(options.storage);
  if (!storage || !sessionId.trim()) return false;

  try {
    storage.setItem(
      DESIGN_PENDING_KEY,
      JSON.stringify({ sessionId, at: options.now ?? Date.now() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearPendingDesign(options: StorageOptions = {}): void {
  const storage = resolveStorage(options.storage);
  if (!storage) return;

  try {
    storage.removeItem(DESIGN_PENDING_KEY);
  } catch {
    // Storage can be disabled by the browser.
  }
}
