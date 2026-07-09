import type { MeResponse } from "@essesion/api-client";
import { create } from "zustand";

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

export const useSession = create<SessionState>((set) => ({
  status: "loading",
  accessToken: null,
  user: null,
  setAccessToken: (accessToken) =>
    set({ accessToken, status: accessToken ? "authenticated" : "anonymous" }),
  setUser: (user) => set({ user }),
  clear: () => set({ accessToken: null, user: null, status: "anonymous" }),
}));
