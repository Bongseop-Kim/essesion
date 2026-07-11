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
  setUser: (user: MeResponse | null) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  accessToken: null,
  user: null,
  setAccessToken: (accessToken) =>
    set({ accessToken, status: accessToken ? "authenticated" : "anonymous" }),
  setUser: (user) => {
    const previousUserId = get().user?.id;
    if (previousUserId && previousUserId !== user?.id) {
      queryClient.removeQueries();
    }
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
