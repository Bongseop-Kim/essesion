import type { MeResponse } from "@essesion/api-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  refreshTokens: vi.fn(),
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
vi.mock("@/shared/lib/observability", () => ({ setRequestIdTag: vi.fn() }));

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

function user(id: string) {
  return { id, name: `user-${id}` } as MeResponse;
}

describe("store API session coordination", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    api.getMe.mockReset();
    api.refreshTokens.mockReset();
    api.getMe.mockResolvedValue({ data: user("a") });
    FakeBroadcastChannel.instances = [];
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.stubGlobal("navigator", { locks: serialLocks() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("동시 bootstrap/401 refresh를 Web Lock 안에서 한 번만 회전한다", async () => {
    api.refreshTokens.mockResolvedValue({
      data: { access_token: "replacement-token" },
      response: new Response(null, { status: 200 }),
    });
    const module = await import("./api-client");

    const [first, second] = await Promise.all([
      module.refreshStoreAccessToken(undefined, null),
      module.refreshStoreAccessToken(undefined, null),
    ]);

    expect(first).toBe("replacement-token");
    expect(second).toBe("replacement-token");
    expect(api.refreshTokens).toHaveBeenCalledTimes(1);
    expect(FakeBroadcastChannel.instances[0]?.messages).toContainEqual({
      type: "token",
      token: "replacement-token",
    });
  });

  it("다른 탭의 logout 방송이 메모리 토큰과 사용자 세션을 지운다", async () => {
    const module = await import("./api-client");
    const { useSession } = await import("../store/session");
    module.setStoreAccessToken("access-token");

    FakeBroadcastChannel.instances[0]?.emit({ type: "logout" });

    expect(useSession.getState()).toMatchObject({
      status: "anonymous",
      accessToken: null,
      user: null,
    });
  });

  it("다른 계정 토큰 방송을 loading에서 재검증한 뒤 사용자와 함께 전환한다", async () => {
    const nextMe = deferred<{ data: ReturnType<typeof user> }>();
    api.getMe.mockReturnValue(nextMe.promise);
    const module = await import("./api-client");
    const { queryClient } = await import("./query-client");
    const { useSession } = await import("../store/session");
    module.setStoreAccessToken("access-a");
    useSession.getState().completeAuthentication(user("a"), "access-a");
    queryClient.setQueryData(["account-data"], "user-a-data");

    FakeBroadcastChannel.instances[0]?.emit({
      type: "token",
      token: "access-b",
    });

    expect(useSession.getState()).toMatchObject({
      status: "loading",
      accessToken: "access-b",
      user: user("a"),
    });

    nextMe.resolve({ data: user("b") });
    await vi.waitFor(() =>
      expect(useSession.getState()).toMatchObject({
        status: "authenticated",
        accessToken: "access-b",
        user: user("b"),
      }),
    );
    expect(queryClient.getQueryData(["account-data"])).toBeUndefined();
    queryClient.clear();
  });

  it("같은 계정의 정상 refresh도 검증 중에만 loading이고 사용자를 유지한다", async () => {
    const nextMe = deferred<{ data: ReturnType<typeof user> }>();
    api.getMe.mockReturnValue(nextMe.promise);
    api.refreshTokens.mockResolvedValue({
      data: { access_token: "access-a2" },
      response: new Response(null, { status: 200 }),
    });
    const module = await import("./api-client");
    const { queryClient } = await import("./query-client");
    const { useSession } = await import("../store/session");
    module.setStoreAccessToken("access-a1");
    useSession.getState().completeAuthentication(user("a"), "access-a1");
    queryClient.setQueryData(["account-data"], "kept");

    const refreshing = module.refreshStoreAccessToken();
    await vi.waitFor(() => expect(api.getMe).toHaveBeenCalledTimes(1));
    expect(useSession.getState()).toMatchObject({
      status: "loading",
      accessToken: "access-a2",
      user: user("a"),
    });

    nextMe.resolve({ data: user("a") });
    await expect(refreshing).resolves.toBe("access-a2");
    expect(useSession.getState()).toMatchObject({
      status: "authenticated",
      accessToken: "access-a2",
      user: user("a"),
    });
    expect(queryClient.getQueryData(["account-data"])).toBe("kept");
    queryClient.clear();
  });

  it("refresh 쿠키가 거부되면 모든 탭에 세션 무효화를 알린다", async () => {
    api.refreshTokens.mockResolvedValue({
      error: new Error("expired"),
      response: new Response(null, { status: 401 }),
    });
    const module = await import("./api-client");

    await expect(module.refreshStoreAccessToken()).resolves.toBeNull();
    expect(FakeBroadcastChannel.instances[0]?.messages).toContainEqual({
      type: "logout",
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
