import type { MeResponse } from "@essesion/api-client";
import { beforeEach, describe, expect, it } from "vitest";

import { queryClient } from "@/shared/lib/query-client";

import { useSession } from "./session";

const PRIVATE_QUERY_KEY = ["private", "design-sessions"] as const;

function user(id: string): MeResponse {
  return {
    id,
    name: `user-${id}`,
    email: `${id}@example.com`,
    phone: null,
    phone_verified: false,
    birth: null,
    role: "customer",
    notification_enabled: true,
    notification_consent: true,
    marketing_kakao_sms_consent: false,
    created_at: "2026-07-11T00:00:00.000Z",
  };
}

function cachePrivateData(owner: string) {
  queryClient.setQueryData(PRIVATE_QUERY_KEY, { owner });
}

beforeEach(() => {
  queryClient.removeQueries();
  useSession.setState({
    status: "anonymous",
    accessToken: null,
    user: null,
  });
});

describe("session query-cache boundary", () => {
  it("인증 세션을 지울 때 이전 사용자의 쿼리 캐시를 제거한다", () => {
    useSession.setState({
      status: "authenticated",
      accessToken: "access-a",
      user: user("a"),
    });
    cachePrivateData("a");

    useSession.getState().clear();

    expect(queryClient.getQueryData(PRIVATE_QUERY_KEY)).toBeUndefined();
    expect(useSession.getState()).toMatchObject({
      status: "anonymous",
      accessToken: null,
      user: null,
    });
  });

  it("초기 익명 부트스트랩 실패는 이미 진행 중인 공개 쿼리를 지우지 않는다", () => {
    cachePrivateData("public-data-sentinel");

    useSession.getState().clear();

    expect(queryClient.getQueryData(PRIVATE_QUERY_KEY)).toEqual({
      owner: "public-data-sentinel",
    });
  });

  it("같은 SPA에서 사용자 ID가 바뀌면 이전 계정 캐시를 제거한다", () => {
    useSession.setState({
      status: "authenticated",
      accessToken: "access-a",
      user: user("a"),
    });
    cachePrivateData("a");

    useSession.getState().setUser(user("b"));

    expect(queryClient.getQueryData(PRIVATE_QUERY_KEY)).toBeUndefined();
    expect(useSession.getState().user?.id).toBe("b");
  });

  it("같은 사용자의 프로필 갱신은 유효한 쿼리 캐시를 유지한다", () => {
    useSession.setState({
      status: "authenticated",
      accessToken: "access-a",
      user: user("a"),
    });
    cachePrivateData("a");

    useSession.getState().setUser({ ...user("a"), name: "updated" });

    expect(queryClient.getQueryData(PRIVATE_QUERY_KEY)).toEqual({ owner: "a" });
    expect(useSession.getState().user?.name).toBe("updated");
  });
});
