import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
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

describe("store API session coordination", () => {
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
