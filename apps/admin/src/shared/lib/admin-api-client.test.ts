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

    expect(module.getAdminAccessToken()).toBeNull();
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
    const tokenApi = await import("./admin-api-client");

    await expect(
      sessionApi.apiAdminSessionAdapter.login({
        email: "admin@test.local",
        password: "password",
      }),
    ).rejects.toThrow("role lookup failed");
    expect(tokenApi.getAdminAccessToken()).toBeNull();
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

    expect(module.getAdminAccessToken() === null).toBe(cleared);
  });
});
