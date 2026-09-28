import { adminLogin, getMe } from "@essesion/api-client";

import {
  clearAdminAccessToken,
  refreshAdminAccessToken,
  logoutAdminSession as revokeAdminSession,
  setAdminAccessToken,
  subscribeToAdminSessionInvalidation,
} from "../lib/admin-api-client";
import type { AdminCredentials, AdminSession } from "./admin-session";

/** 계정 정보나 관리자 역할 문제로 로그인이 거절됐을 때 — 네트워크·서버 오류와 구분한다. */
export class AdminCredentialsError extends Error {}

function asAdminSession(value: {
  id: string;
  name: string;
  role: string;
}): AdminSession {
  if (value.role !== "admin" && value.role !== "manager") {
    throw new AdminCredentialsError("관리자 권한이 없는 계정입니다.");
  }
  return {
    userId: value.id,
    displayName: value.name,
    role: value.role,
  };
}

async function loadCurrentAdmin(signal?: AbortSignal) {
  const result = await getMe({ signal });
  if (result.data !== undefined) return asAdminSession(result.data);
  if (result.response?.status === 401 || result.response?.status === 403) {
    clearAdminAccessToken({ broadcast: true });
    return null;
  }
  throw result.error ?? new Error("관리자 정보를 불러오지 못했습니다.");
}

export { subscribeToAdminSessionInvalidation as subscribeAdminSession };

export async function bootstrapAdminSession(signal: AbortSignal) {
  // Provider cancellation suppresses stale state writes. Do not abort the shared
  // refresh itself: React StrictMode remounts and other tabs may be awaiting it.
  const token = await refreshAdminAccessToken(undefined, null);
  if (token === null) return null;
  return loadCurrentAdmin(signal);
}

export async function loginAdminSession(credentials: AdminCredentials) {
  const result = await adminLogin({ body: credentials });
  const token = result.data?.access_token;
  if (token === undefined) {
    const status = result.response?.status;
    if (status === 401 || status === 403) {
      throw new AdminCredentialsError("관리자 계정 정보를 확인해 주세요.");
    }
    throw result.error ?? new Error("로그인하지 못했습니다.");
  }
  setAdminAccessToken(token);
  try {
    const session = await loadCurrentAdmin();
    if (session === null) throw new Error("관리자 세션을 확인하지 못했습니다.");
    return session;
  } catch (error) {
    clearAdminAccessToken();
    throw error;
  }
}

export { revokeAdminSession as logoutAdminSession };
