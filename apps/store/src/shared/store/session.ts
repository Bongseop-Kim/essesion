import type { MeResponse } from "@essesion/api-client";
import { useSyncExternalStore } from "react";

import { queryClient } from "@/shared/lib/query-client";

/** loading: 부트스트랩(리프레시 시도) 중 · authenticated · anonymous */
type SessionStatus = "loading" | "authenticated" | "anonymous";

export interface SessionState {
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

type Listener = () => void;
type Selector<T> = (state: SessionState) => T;

const listeners = new Set<Listener>();
const update = (partial: Partial<SessionState>) => {
  state = { ...state, ...partial };
  for (const listener of listeners) listener();
};

let state: SessionState = {
  status: "loading",
  accessToken: null,
  user: null,
  setAccessToken(accessToken) {
    if (!accessToken) {
      update({ accessToken: null, user: null, status: "anonymous" });
    } else if (state.accessToken !== accessToken) {
      update({ accessToken, status: "loading" });
    }
  },
  completeAuthentication(user, expectedToken) {
    if (state.accessToken !== expectedToken) return false;
    clearPreviousUserCache(state.user, user);
    update({ user, status: "authenticated" });
    return true;
  },
  setUser(user) {
    clearPreviousUserCache(state.user, user);
    update({ user });
  },
  clear() {
    if (
      state.status === "authenticated" ||
      state.accessToken !== null ||
      state.user !== null
    ) {
      queryClient.removeQueries();
    }
    update({ accessToken: null, user: null, status: "anonymous" });
  },
};

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type SessionStore = {
  <T>(selector: Selector<T>): T;
  getState: () => SessionState;
  setState: (partial: Partial<SessionState>) => void;
  subscribe: (listener: Listener) => () => void;
};

export const useSession: SessionStore = Object.assign(
  <T>(selector: Selector<T>) =>
    useSyncExternalStore(
      subscribe,
      () => selector(state),
      () => selector(state),
    ),
  {
    getState: () => state,
    setState: update,
    subscribe,
  },
);
