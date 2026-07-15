import { adminLogout, adminRefreshTokens, getMe } from "@essesion/api-client";
import { client } from "@essesion/api-client/client";

import { API_BASE_URL } from "../config/env";

const REFRESH_LOCK = "essesion-admin-refresh";
const CHANNEL_NAME = "essesion-admin-session";
const SESSION_INVALIDATED_EVENT = "essesion:admin-session-invalidated";

type SessionMessage = { type: "token"; token: string } | { type: "logout" };

let accessToken: string | null = null;
let tokenRevision = 0;
let localRefresh: Promise<string | null> | null = null;
let roleCheck: Promise<void> | null = null;

const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(CHANNEL_NAME);

function notifySessionInvalidated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT));
  }
}

function publish(message: SessionMessage) {
  channel?.postMessage(message);
}

export function setAdminAccessToken(token: string, broadcast = true) {
  accessToken = token;
  tokenRevision += 1;
  if (broadcast) publish({ type: "token", token });
}

export function clearAdminAccessToken(
  options: { broadcast?: boolean; notify?: boolean } = {},
) {
  const { broadcast = false, notify = false } = options;
  accessToken = null;
  tokenRevision += 1;
  if (broadcast) publish({ type: "logout" });
  if (notify) notifySessionInvalidated();
}

channel?.addEventListener("message", (event: MessageEvent<SessionMessage>) => {
  if (event.data.type === "token") {
    setAdminAccessToken(event.data.token, false);
    return;
  }
  clearAdminAccessToken({ notify: true });
});

async function requestRefresh(signal?: AbortSignal) {
  const result = await adminRefreshTokens({ signal });
  const token = result.data?.access_token;
  if (token !== undefined) {
    setAdminAccessToken(token);
    return token;
  }

  if (result.response?.status === 401 || result.response?.status === 403) {
    clearAdminAccessToken({ broadcast: true, notify: true });
    return null;
  }
  throw result.error ?? new Error("관리자 세션을 갱신하지 못했습니다.");
}

/**
 * Refresh rotation is single-flight in one tab and exclusive across tabs.
 * If another tab published a replacement while this caller waited, reuse it.
 */
export async function refreshAdminAccessToken(
  signal?: AbortSignal,
  staleToken: string | null = accessToken,
) {
  const revisionAtStart = tokenRevision;
  const refresh = async () => {
    if (
      accessToken !== null &&
      (accessToken !== staleToken || tokenRevision !== revisionAtStart)
    ) {
      return accessToken;
    }
    return requestRefresh(signal);
  };

  if (typeof navigator !== "undefined" && navigator.locks !== undefined) {
    return navigator.locks.request(
      REFRESH_LOCK,
      { mode: "exclusive", signal },
      refresh,
    );
  }

  localRefresh ??= refresh().finally(() => {
    localRefresh = null;
  });
  return localRefresh;
}

export async function logoutAdminSession() {
  try {
    const result = await adminLogout();
    if (result.error !== undefined) throw result.error;
  } finally {
    clearAdminAccessToken({ broadcast: true });
  }
}

export function subscribeToAdminSessionInvalidation(listener: () => void) {
  window.addEventListener(SESSION_INVALIDATED_EVENT, listener);
  return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, listener);
}

async function verifyRoleAfterForbidden() {
  try {
    const result = await getMe();
    const role = result.data?.role;
    const status = result.response?.status;
    const confirmedRoleLoss =
      status === 401 ||
      status === 403 ||
      (result.data !== undefined && role !== "admin" && role !== "manager");
    if (confirmedRoleLoss) {
      clearAdminAccessToken({ broadcast: true, notify: true });
    }
  } catch {
    // 네트워크·5xx·역직렬화 오류는 권한 상실의 증거가 아니다. 다음 요청에서 재검증한다.
  }
}

client.setConfig({
  baseUrl: API_BASE_URL,
  credentials: "include",
});

client.interceptors.request.use((request) => {
  if (accessToken !== null && !request.headers.has("Authorization")) {
    request.headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return request;
});

client.interceptors.response.use(async (response, request) => {
  const path = new URL(request.url).pathname;

  if (response.status === 403 && path.startsWith("/admin")) {
    roleCheck ??= verifyRoleAfterForbidden().finally(() => {
      roleCheck = null;
    });
    await roleCheck;
    return response;
  }

  if (response.status !== 401 || path.startsWith("/auth/")) return response;

  const authorization = request.headers.get("Authorization");
  const staleToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  const token = await refreshAdminAccessToken(undefined, staleToken);
  if (
    token === null ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return response;
  }

  const retried = new Request(request);
  retried.headers.set("Authorization", `Bearer ${token}`);
  return fetch(retried);
});
