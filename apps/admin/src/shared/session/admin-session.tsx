import { ContentPlaceholder, ProgressCircle } from "@essesion/shared";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type AdminRole = "admin" | "manager";

export type AdminSession = {
  userId: string;
  displayName: string;
  role: AdminRole;
};

export type AdminCredentials = {
  email: string;
  password: string;
};

export type AdminSessionAdapter = {
  availability: "ready" | "unavailable";
  bootstrap: (signal: AbortSignal) => Promise<AdminSession | null>;
  login: (credentials: AdminCredentials) => Promise<AdminSession>;
  logout: () => Promise<void>;
  subscribe?: (onInvalidated: () => void) => () => void;
};

/**
 * Admin auth OpenAPI가 생성되기 전 사용하는 명시적 경계다.
 * 직접 HTTP 요청이나 임시 세션을 만들지 않고 UI를 fail closed로 유지한다.
 */
export const unavailableAdminSessionAdapter: AdminSessionAdapter = {
  availability: "unavailable",
  bootstrap: () =>
    Promise.reject(new Error("관리자 인증 API가 아직 연결되지 않았습니다.")),
  login: () =>
    Promise.reject(new Error("관리자 인증 API가 아직 연결되지 않았습니다.")),
  logout: () =>
    Promise.reject(new Error("관리자 인증 API가 아직 연결되지 않았습니다.")),
};

type AdminSessionState =
  | { status: "loading" }
  | { status: "authenticated"; session: AdminSession }
  | { status: "anonymous" }
  | { status: "unavailable" }
  | { status: "error" };

type AdminSessionContextValue = {
  state: AdminSessionState;
  retryBootstrap: () => void;
  login: (credentials: AdminCredentials) => Promise<void>;
  logout: () => Promise<void>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(
  null,
);

export type AdminSessionProviderProps = {
  adapter: AdminSessionAdapter;
  clearSensitiveCache: () => void;
  children: ReactNode;
};

export function AdminSessionProvider({
  adapter,
  clearSensitiveCache,
  children,
}: AdminSessionProviderProps) {
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [state, setState] = useState<AdminSessionState>(() =>
    adapter.availability === "ready"
      ? { status: "loading" }
      : { status: "unavailable" },
  );

  useEffect(() => {
    if (adapter.availability === "unavailable") {
      clearSensitiveCache();
      setState({ status: "unavailable" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });
    void adapter
      .bootstrap(controller.signal)
      .then((session) => {
        if (controller.signal.aborted) return;
        if (session === null) {
          clearSensitiveCache();
          setState({ status: "anonymous" });
          return;
        }
        setState({ status: "authenticated", session });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        clearSensitiveCache();
        setState({ status: "error" });
      });

    return () => controller.abort();
  }, [adapter, bootstrapAttempt, clearSensitiveCache]);

  useEffect(() => {
    return adapter.subscribe?.(() => {
      clearSensitiveCache();
      setState({ status: "anonymous" });
    });
  }, [adapter, clearSensitiveCache]);

  const retryBootstrap = useCallback(() => {
    if (adapter.availability === "ready") {
      setBootstrapAttempt((attempt) => attempt + 1);
    }
  }, [adapter]);

  const login = useCallback(
    async (credentials: AdminCredentials) => {
      setState({ status: "loading" });
      try {
        const session = await adapter.login(credentials);
        setState({ status: "authenticated", session });
      } catch (error) {
        clearSensitiveCache();
        setState({ status: "anonymous" });
        throw error;
      }
    },
    [adapter, clearSensitiveCache],
  );

  const logout = useCallback(async () => {
    try {
      await adapter.logout();
    } finally {
      clearSensitiveCache();
      setState({ status: "anonymous" });
    }
  }, [adapter, clearSensitiveCache]);

  const value = useMemo(
    () => ({ state, retryBootstrap, login, logout }),
    [login, logout, retryBootstrap, state],
  );

  return (
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession() {
  const context = useContext(AdminSessionContext);
  if (context === null) {
    throw new Error(
      "useAdminSession은 AdminSessionProvider 안에서 사용해야 합니다.",
    );
  }
  return context;
}

export function SessionBootstrapPending() {
  return (
    <ContentPlaceholder
      icon={<ProgressCircle aria-label="관리자 세션 확인 중" />}
      title="관리자 세션을 확인하고 있습니다"
    />
  );
}
