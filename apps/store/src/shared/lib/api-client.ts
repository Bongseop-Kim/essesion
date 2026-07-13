import { getMe, refreshTokens } from "@essesion/api-client";
import { client } from "@essesion/api-client/client";

import { API_BASE_URL } from "@/shared/config/env";
import { setRequestIdTag } from "@/shared/lib/observability";
import { useSession } from "@/shared/store/session";

const REFRESH_LOCK = "essesion-store-refresh";
const CHANNEL_NAME = "essesion-store-session";

type SessionMessage = { type: "token"; token: string } | { type: "logout" };

let accessToken: string | null = null;
let tokenRevision = 0;
let localRefresh: Promise<string | null> | null = null;

const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(CHANNEL_NAME);

function publish(message: SessionMessage) {
  channel?.postMessage(message);
}

function replaceAccessToken(token: string) {
  if (accessToken === token) return false;
  accessToken = token;
  tokenRevision += 1;
  return true;
}

export function getStoreTokenSnapshot() {
  return { accessToken, revision: tokenRevision } as const;
}

/** 현재 탭에 토큰을 설치하고, 필요하면 회전된 토큰을 다른 탭에도 알린다. */
export function setStoreAccessToken(token: string, broadcast = false) {
  const changed = replaceAccessToken(token);
  useSession.getState().setAccessToken(token);
  if (broadcast && changed) publish({ type: "token", token });
}

/** 명시적 로그아웃과 refresh 재사용 감지 결과를 모든 탭에 전파한다. */
export function clearStoreSession(broadcast = false) {
  accessToken = null;
  tokenRevision += 1;
  useSession.getState().clear();
  if (broadcast) publish({ type: "logout" });
}

channel?.addEventListener("message", (event: MessageEvent<SessionMessage>) => {
  if (event.data.type === "token") {
    const changed = replaceAccessToken(event.data.token);
    // 토큰 설치 자체는 상태를 authenticated로 바꾸지 않는다. 따라서 부트스트랩
    // 중인 탭도 최신 토큰을 보존하면서 getMe 완료까지 loading을 유지할 수 있다.
    useSession.getState().setAccessToken(event.data.token);
    if (changed) {
      void authenticateCurrentToken().then(
        (authenticated) => {
          if (!authenticated) clearStoreSession();
        },
        () => clearStoreSession(),
      );
    }
    return;
  }
  clearStoreSession();
});

// 생성 client 싱글턴을 한 곳에서 설정 — 모든 SDK 호출이 이 인스턴스를 공유한다.
client.setConfig({
  baseUrl: API_BASE_URL,
  // refresh_token 쿠키(path=/auth)를 /auth/refresh·/auth/logout 요청에 실어보낸다.
  credentials: "include",
});

// 요청마다 메모리의 액세스 토큰을 Bearer로 주입(공개 엔드포인트엔 무해).
client.interceptors.request.use((request) => {
  if (accessToken && !request.headers.has("Authorization")) {
    request.headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return request;
});

async function requestRefresh(signal?: AbortSignal) {
  const result = await refreshTokens({ signal });
  const token = result.data?.access_token;
  if (token !== undefined) {
    setStoreAccessToken(token, true);
    try {
      if (!(await authenticateCurrentToken())) {
        clearStoreSession(true);
        return null;
      }
    } catch (error) {
      clearStoreSession(true);
      throw error;
    }
    return token;
  }

  if (result.response?.status === 401 || result.response?.status === 403) {
    clearStoreSession(true);
    return null;
  }
  throw result.error ?? new Error("세션을 갱신하지 못했습니다.");
}

/** 토큰이 조회 중 회전되면 stale 사용자 응답을 버리고 최신 토큰으로 다시 검증한다. */
export async function authenticateCurrentToken(
  isCancelled: () => boolean = () => false,
): Promise<boolean> {
  while (!isCancelled()) {
    const expected = getStoreTokenSnapshot();
    if (expected.accessToken === null) return false;
    const session = useSession.getState();
    if (
      session.status === "authenticated" &&
      session.accessToken === expected.accessToken
    ) {
      return true;
    }

    let me: Awaited<ReturnType<typeof getMe>>;
    try {
      me = await getMe();
    } catch (error) {
      if (isCancelled()) return false;
      if (getStoreTokenSnapshot().revision !== expected.revision) continue;
      throw error;
    }
    if (isCancelled()) return false;

    const current = getStoreTokenSnapshot();
    if (current.revision !== expected.revision) continue;
    if (!me.data) return false;

    if (
      useSession
        .getState()
        .completeAuthentication(me.data, expected.accessToken)
    ) {
      return true;
    }
    return false;
  }
  return false;
}

/**
 * 한 탭에서는 single-flight, 여러 탭에서는 Web Lock으로 refresh 회전을 직렬화한다.
 * 잠금 대기 중 다른 탭이 새 토큰을 방송했다면 쿠키를 다시 회전하지 않고 재사용한다.
 */
export async function refreshStoreAccessToken(
  signal?: AbortSignal,
  staleToken: string | null = accessToken,
) {
  const revisionAtStart = tokenRevision;
  const refresh = async () => {
    if (
      accessToken !== null &&
      (accessToken !== staleToken || tokenRevision !== revisionAtStart)
    ) {
      if (await authenticateCurrentToken()) return accessToken;
      clearStoreSession();
      return null;
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

// 401 → refresh 1회 → 안전한 원요청만 재시도한다. /auth/* 응답은 제외해
// refresh 자체의 401이 재귀하지 않게 한다.
client.interceptors.response.use(async (response, request) => {
  setRequestIdTag(response.headers.get("x-request-id"));
  const path = new URL(request.url).pathname;
  if (response.status !== 401 || path.startsWith("/auth/")) return response;

  const authorization = request.headers.get("Authorization");
  const staleToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  const token = await refreshStoreAccessToken(undefined, staleToken);
  if (
    token === null ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return response;
  }

  try {
    const retried = new Request(request);
    retried.headers.set("Authorization", `Bearer ${token}`);
    return fetch(retried);
  } catch {
    return response;
  }
});
