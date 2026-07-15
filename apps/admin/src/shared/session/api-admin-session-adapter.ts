import { adminLogin, getMe } from "@essesion/api-client";

import {
  clearAdminAccessToken,
  logoutAdminSession,
  refreshAdminAccessToken,
  setAdminAccessToken,
  subscribeToAdminSessionInvalidation,
} from "../lib/admin-api-client";
import type { AdminSession, AdminSessionAdapter } from "./admin-session";

function asAdminSession(value: {
  id: string;
  name: string;
  role: string;
}): AdminSession {
  if (value.role !== "admin" && value.role !== "manager") {
    throw new Error("관리자 역할이 없는 계정입니다.");
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

export const apiAdminSessionAdapter: AdminSessionAdapter = {
  subscribe: subscribeToAdminSessionInvalidation,
  async bootstrap(signal) {
    // Provider cancellation suppresses stale state writes. Do not abort the shared
    // refresh itself: React StrictMode remounts and other tabs may be awaiting it.
    const token = await refreshAdminAccessToken(undefined, null);
    if (token === null) return null;
    return loadCurrentAdmin(signal);
  },
  async login(credentials) {
    const result = await adminLogin({ body: credentials });
    const token = result.data?.access_token;
    if (token === undefined) {
      throw result.error ?? new Error("관리자 로그인에 실패했습니다.");
    }
    setAdminAccessToken(token);
    try {
      const session = await loadCurrentAdmin();
      if (session === null)
        throw new Error("관리자 세션을 확인하지 못했습니다.");
      return session;
    } catch (error) {
      clearAdminAccessToken();
      throw error;
    }
  },
  logout: logoutAdminSession,
};
