import type { MeResponse } from "@essesion/api-client";
import { create } from "zustand";

import { queryClient } from "@/shared/lib/query-client";

/** loading: 부트스트랩(리프레시 시도) 중 · authenticated · anonymous */
type SessionStatus = "loading" | "authenticated" | "anonymous";

interface SessionState {
  status: SessionStatus;
  /** 액세스 토큰은 메모리에만 둔다(localStorage 금지 — XSS). refresh는 httpOnly 쿠키. */
  accessToken: string | null;
  user: MeResponse | null;
  setAccessToken: (token: string | null) => void;
  completeAuthentication: (user: MeResponse, expectedToken: string) => boolean;
  setUser: (user: MeResponse | null) => void;
  clear: () => void;
}

function clearPreviousUserCache(
  previous: MeResponse | null,
  next: MeResponse | null,
) {
  if (previous?.id && previous.id !== next?.id) queryClient.removeQueries();
}

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  accessToken: null,
  user: null,
  setAccessToken: (accessToken) =>
    set((state) => {
      if (!accessToken) {
        return { accessToken: null, user: null, status: "anonymous" };
      }
      if (state.accessToken === accessToken) return { accessToken };
      return { accessToken, status: "loading" };
    }),
  completeAuthentication: (user, expectedToken) => {
    const current = get();
    if (current.accessToken !== expectedToken) return false;
    clearPreviousUserCache(current.user, user);
    set({ user, status: "authenticated" });
    return true;
  },
  setUser: (user) => {
    clearPreviousUserCache(get().user, user);
    set({ user });
  },
  clear: () => {
    const current = get();
    if (
      current.status === "authenticated" ||
      current.accessToken !== null ||
      current.user !== null
    ) {
      queryClient.removeQueries();
    }
    set({ accessToken: null, user: null, status: "anonymous" });
  },
}));
