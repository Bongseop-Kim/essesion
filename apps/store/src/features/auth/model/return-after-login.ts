const AUTH_RETURN_KEY = "essesion:auth:return:v1";

export type AuthReturn = {
  path: string;
  state?: unknown;
};

export function saveAuthReturn(value: AuthReturn) {
  sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify(value));
}

export function saveAuthReturnIfEmpty(value: AuthReturn) {
  if (sessionStorage.getItem(AUTH_RETURN_KEY) == null) saveAuthReturn(value);
}

export function takeAuthReturn(): AuthReturn | null {
  try {
    const raw = sessionStorage.getItem(AUTH_RETURN_KEY);
    sessionStorage.removeItem(AUTH_RETURN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    return typeof value.path === "string" &&
      value.path.startsWith("/") &&
      !value.path.startsWith("//")
      ? { path: value.path, state: value.state }
      : null;
  } catch {
    sessionStorage.removeItem(AUTH_RETURN_KEY);
    return null;
  }
}
