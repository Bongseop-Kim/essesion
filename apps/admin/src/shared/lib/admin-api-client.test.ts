import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  adminLogin: vi.fn(),
  adminRefreshTokens: vi.fn(),
  adminLogout: vi.fn(),
  getMe: vi.fn(),
}));

const client = vi.hoisted(() => ({
  setConfig: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
}));

vi.mock("@essesion/api-client", () => api);
vi.mock("@essesion/api-client/client", () => ({ client }));

type MessageListener = (event: MessageEvent) => void;

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  listeners: MessageListener[] = [];
  messages: unknown[] = [];

  constructor(public name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  addEventListener(_type: string, listener: MessageListener) {
    this.listeners.push(listener);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  emit(message: unknown) {
    for (const listener of this.listeners) {
      listener(new MessageEvent("message", { data: message }));
    }
  }
}

// 메모리 access token은 요청 인터셉터가 Authorization 헤더를 붙이는지로만 관찰한다.
async function requestCarriesAuthorization() {
  const requestInterceptor = client.interceptors.request.use.mock.calls[0]?.[0];
  const request = await requestInterceptor(
    new Request("http://test/admin/orders"),
  );
  return request.headers.has("Authorization");
}

function serialLocks() {
  let tail = Promise.resolve();
  return {
    request: vi.fn(
      <T>(
        _name: string,
        _options: unknown,
        callback: () => T | PromiseLike<T>,
      ) => {
        const result = tail.then(callback);
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    ),
  };
}

describe("admin API session coordination", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    FakeBroadcastChannel.instances = [];
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.stubGlobal("navigator", { locks: serialLocks() });
    // 요청 인터셉터가 콜드 스타트에서 refresh를 시도하므로, 명시하지 않은 테스트는 실패로 고정한다.
    api.adminRefreshTokens.mockRejectedValue(new Error("no refresh session"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("여러 탭 역할의 동시 refresh를 Web Lock 안에서 한 번만 회전한다", async () => {
    api.adminRefreshTokens.mockResolvedValue({
      data: { access_token: "replacement-token" },
      response: new Response(null, { status: 200 }),
    });
    const module = await import("./admin-api-client");

    const [first, second] = await Promise.all([
      module.refreshAdminAccessToken(undefined, null),
      module.refreshAdminAccessToken(undefined, null),
    ]);

    expect(first).toBe("replacement-token");
    expect(second).toBe("replacement-token");
    expect(api.adminRefreshTokens).toHaveBeenCalledTimes(1);
    expect(FakeBroadcastChannel.instances[0]?.messages).toContainEqual({
      type: "token",
      token: "replacement-token",
    });
  });

  it("다른 탭의 logout 방송이 메모리 토큰과 보호 캐시 구독을 무효화한다", async () => {
    const module = await import("./admin-api-client");
    const invalidated = vi.fn();
    module.setAdminAccessToken("admin-access", false);
    const unsubscribe = module.subscribeToAdminSessionInvalidation(invalidated);

    FakeBroadcastChannel.instances[0]?.emit({ type: "logout" });

    expect(await requestCarriesAuthorization()).toBe(false);
    expect(invalidated).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("로그인 후 역할 확인 실패 시 임시 access token을 남기지 않는다", async () => {
    api.adminLogin.mockResolvedValue({
      data: { access_token: "unverified-admin-token" },
      response: new Response(null, { status: 200 }),
    });
    api.getMe.mockResolvedValue({
      error: new Error("role lookup failed"),
      response: new Response(null, { status: 500 }),
    });
    const sessionApi = await import("../session/api-admin-session-adapter");

    await expect(
      sessionApi.apiAdminSessionAdapter.login({
        email: "admin@test.local",
        password: "password",
      }),
    ).rejects.toThrow("role lookup failed");
    expect(await requestCarriesAuthorization()).toBe(false);
  });

  it.each([
    {
      name: "관리자 역할",
      result: {
        data: { role: "admin" },
        response: new Response(null, { status: 200 }),
      },
      cleared: false,
    },
    {
      name: "role probe 5xx",
      result: {
        error: new Error("temporary failure"),
        response: new Response(null, { status: 500 }),
      },
      cleared: false,
    },
    {
      name: "role probe 401",
      result: {
        error: new Error("expired"),
        response: new Response(null, { status: 401 }),
      },
      cleared: true,
    },
    {
      name: "확인된 customer 역할",
      result: {
        data: { role: "customer" },
        response: new Response(null, { status: 200 }),
      },
      cleared: true,
    },
  ])("관리자 403 이후 $name 결과에 맞게 세션을 보존한다", async ({
    result,
    cleared,
  }) => {
    api.getMe.mockResolvedValue(result);
    const module = await import("./admin-api-client");
    module.setAdminAccessToken("still-valid-admin-token", false);
    const interceptor = client.interceptors.response.use.mock.calls[0]?.[0];

    await interceptor(
      new Response(null, { status: 403 }),
      new Request("http://test/admin/orders"),
    );

    expect(await requestCarriesAuthorization()).toBe(!cleared);
  });

  it("토큰 없는 첫 요청은 refresh 완료를 기다렸다가 Authorization을 부착한다", async () => {
    api.adminRefreshTokens.mockResolvedValue({
      data: { access_token: "cold-start-token" },
      response: new Response(null, { status: 200 }),
    });
    await import("./admin-api-client");
    const requestInterceptor =
      client.interceptors.request.use.mock.calls[0]?.[0];

    const request = await requestInterceptor(
      new Request("http://test/admin/orders"),
    );

    expect(request.headers.get("Authorization")).toBe(
      "Bearer cold-start-token",
    );
    expect(api.adminRefreshTokens).toHaveBeenCalledTimes(1);
  });

  it("401을 받은 POST 요청도 refresh 후 원본 body로 재시도한다", async () => {
    api.adminRefreshTokens.mockResolvedValue({
      data: { access_token: "rotated-token" },
      response: new Response(null, { status: 200 }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const module = await import("./admin-api-client");
    module.setAdminAccessToken("stale-token", false);
    const requestInterceptor =
      client.interceptors.request.use.mock.calls[0]?.[0];
    const responseInterceptor =
      client.interceptors.response.use.mock.calls[0]?.[0];

    const request = await requestInterceptor(
      new Request("http://test/admin/orders/1/memo", {
        method: "POST",
        body: JSON.stringify({ memo: "리테스트" }),
      }),
    );
    const result = await responseInterceptor(
      new Response(null, { status: 401 }),
      request,
    );

    expect(result.status).toBe(200);
    const retried = fetchMock.mock.calls[0]?.[0] as Request;
    expect(retried.method).toBe("POST");
    expect(retried.headers.get("Authorization")).toBe("Bearer rotated-token");
    await expect(retried.text()).resolves.toBe(
      JSON.stringify({ memo: "리테스트" }),
    );
  });

  it("재시도마저 401이면 세션을 무효화해 로그인으로 유도한다", async () => {
    api.adminRefreshTokens.mockResolvedValue({
      data: { access_token: "rotated-token" },
      response: new Response(null, { status: 200 }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    const module = await import("./admin-api-client");
    const invalidated = vi.fn();
    module.subscribeToAdminSessionInvalidation(invalidated);
    module.setAdminAccessToken("stale-token", false);
    const requestInterceptor =
      client.interceptors.request.use.mock.calls[0]?.[0];
    const responseInterceptor =
      client.interceptors.response.use.mock.calls[0]?.[0];

    const request = await requestInterceptor(
      new Request("http://test/admin/orders"),
    );
    const result = await responseInterceptor(
      new Response(null, { status: 401 }),
      request,
    );

    expect(result.status).toBe(401);
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(FakeBroadcastChannel.instances[0]?.messages).toContainEqual({
      type: "logout",
    });
  });

  it("refresh가 네트워크 오류로 실패하면 원래 401 응답을 반환한다", async () => {
    api.adminRefreshTokens.mockRejectedValue(new Error("network down"));
    const module = await import("./admin-api-client");
    module.setAdminAccessToken("stale-token", false);
    const responseInterceptor =
      client.interceptors.response.use.mock.calls[0]?.[0];

    const original = new Response(null, { status: 401 });
    const request = new Request("http://test/admin/orders", {
      headers: { Authorization: "Bearer stale-token" },
    });
    const result = await responseInterceptor(original, request);

    expect(result).toBe(original);
  });
});
