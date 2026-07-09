import { refreshTokens } from "@essesion/api-client";
import { client } from "@essesion/api-client/client";

import { API_BASE_URL } from "@/shared/config/env";
import { useSession } from "@/shared/store/session";

// 생성 client 싱글턴을 한 곳에서 설정 — 모든 SDK 호출이 이 인스턴스를 공유한다.
client.setConfig({
  baseUrl: API_BASE_URL,
  // refresh_token 쿠키(path=/auth)를 /auth/refresh·/auth/logout 요청에 실어보낸다.
  credentials: "include",
});

// 요청마다 메모리의 액세스 토큰을 Bearer로 주입(공개 엔드포인트엔 무해).
client.interceptors.request.use((request) => {
  const token = useSession.getState().accessToken;
  if (token && !request.headers.has("Authorization")) {
    request.headers.set("Authorization", `Bearer ${token}`);
  }
  return request;
});

// 401 → refresh 1회 → 원요청 재시도. single-flight로 동시 401을 refresh 한 번으로 합친다.
// /auth/* 응답은 제외해 refresh 자체의 401이 재귀하지 않게 한다.
let refreshing: Promise<string | null> | null = null;

function runRefresh(): Promise<string | null> {
  return refreshTokens()
    .then(({ data }) => {
      const token = data?.access_token ?? null;
      if (!token) {
        useSession.getState().clear();
        return null;
      }
      useSession.getState().setAccessToken(token);
      return token;
    })
    .catch(() => {
      useSession.getState().clear();
      return null;
    });
}

client.interceptors.response.use(async (response, request) => {
  const path = new URL(request.url).pathname;
  if (response.status !== 401 || path.startsWith("/auth/")) return response;

  refreshing ??= runRefresh().finally(() => {
    refreshing = null;
  });
  const token = await refreshing;
  if (!token) return response;

  // 새 토큰으로 재시도. ponytail: body가 소비되는 재시도(POST 등)는 미지원 —
  // 401 대상 대부분이 보호 GET이라 충분. 필요해지면 요청옵션 캡처 방식으로 확장.
  const retried = new Request(request);
  retried.headers.set("Authorization", `Bearer ${token}`);
  return fetch(retried);
});
