import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "@/shared/store/session";

const sessionApi = vi.hoisted(() => ({
  authenticateCurrentToken: vi.fn(),
  clearStoreSession: vi.fn(),
  refreshStoreAccessToken: vi.fn(),
  setStoreAccessToken: vi.fn(),
}));

vi.mock("@/shared/lib/api-client", () => sessionApi);

import { bootstrapSession } from "./bootstrap-session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("bootstrapSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ status: "loading", accessToken: null, user: null });
    sessionApi.setStoreAccessToken.mockImplementation((nextToken: string) => {
      useSession.getState().setAccessToken(nextToken);
    });
  });

  it("getMe 검증이 끝날 때까지 loading을 유지하고 한 번에 인증을 완료한다", async () => {
    const authentication = deferred<boolean>();
    sessionApi.refreshStoreAccessToken.mockResolvedValue("access-token");
    sessionApi.authenticateCurrentToken.mockReturnValue(authentication.promise);

    const bootstrapping = bootstrapSession();
    await vi.waitFor(() =>
      expect(sessionApi.authenticateCurrentToken).toHaveBeenCalledTimes(1),
    );

    expect(useSession.getState()).toMatchObject({
      status: "loading",
      accessToken: "access-token",
      user: null,
    });

    authentication.resolve(true);

    await expect(bootstrapping).resolves.toBe(true);
  });

  it("취소된 bootstrap의 늦은 실패가 새 세션을 지우지 않는다", async () => {
    const authentication = deferred<boolean>();
    let cancelled = false;
    sessionApi.refreshStoreAccessToken.mockResolvedValue("access-a");
    sessionApi.authenticateCurrentToken.mockReturnValue(authentication.promise);

    const bootstrapping = bootstrapSession(() => cancelled);
    await vi.waitFor(() =>
      expect(sessionApi.authenticateCurrentToken).toHaveBeenCalledTimes(1),
    );
    cancelled = true;
    sessionApi.setStoreAccessToken("access-b");
    authentication.resolve(false);

    await expect(bootstrapping).resolves.toBe(false);
    expect(sessionApi.clearStoreSession).not.toHaveBeenCalled();
    expect(useSession.getState().accessToken).toBe("access-b");
  });
});
