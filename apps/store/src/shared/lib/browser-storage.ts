export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function resolveStorage(storage: StorageLike | null | undefined) {
  return storage === undefined ? browserStorage() : storage;
}
