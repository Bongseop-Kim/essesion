// @vitest-environment jsdom

import type { DesignGenerateOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readPendingDesign, type StorageLike } from "./pending";

const api = vi.hoisted(() => ({
  createSession: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("@essesion/api-client", () => ({
  createDesignSession: api.createSession,
  generateDesign: api.generate,
}));

vi.mock("@essesion/api-client/query", () => ({
  getDesignSessionQueryKey: ({ path }: { path: { session_id: string } }) => [
    "design-session",
    path.session_id,
  ],
  getTokenBalanceQueryKey: () => ["token-balance"],
  listDesignSessionsQueryKey: () => ["design-sessions"],
  listDesignTurnsQueryKey: ({ path }: { path: { session_id: string } }) => [
    "design-turns",
    path.session_id,
  ],
}));

import { StaleDesignOperationError, useGenerateDesign } from "./use-generate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    } satisfies StorageLike,
  };
}

function queryWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const generated = { designs: [], intents: [] } as unknown as DesignGenerateOut;

describe("useGenerateDesign pending side effects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("늦게 끝난 A가 진행 중인 B marker를 지우지 않는다", async () => {
    const firstResponse = deferred<{ data: DesignGenerateOut }>();
    const secondResponse = deferred<{ data: DesignGenerateOut }>();
    api.generate.mockImplementation(
      ({ body }: { body: { session_id: string } }) =>
        body.session_id === "session-a"
          ? firstResponse.promise
          : secondResponse.promise,
    );
    const { storage } = memoryStorage();
    const queryClient = new QueryClient();
    const { result } = renderHook(
      () =>
        useGenerateDesign({
          pendingStorage: storage,
          onSessionReady: () => true,
        }),
      { wrapper: queryWrapper(queryClient) },
    );

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.mutateAsync({
        mode: "prompt",
        sessionId: "session-a",
        prompt: "A",
      });
    });
    await vi.waitFor(() => expect(api.generate).toHaveBeenCalledTimes(1));
    expect(readPendingDesign({ storage })?.sessionId).toBe("session-a");

    let second!: Promise<unknown>;
    act(() => {
      second = result.current.mutateAsync({
        mode: "prompt",
        sessionId: "session-b",
        prompt: "B",
      });
    });
    await vi.waitFor(() => expect(api.generate).toHaveBeenCalledTimes(2));
    expect(readPendingDesign({ storage })?.sessionId).toBe("session-b");

    firstResponse.resolve({ data: generated });
    await act(async () => {
      await first;
    });
    expect(readPendingDesign({ storage })?.sessionId).toBe("session-b");

    secondResponse.resolve({ data: generated });
    await act(async () => {
      await second;
    });
    expect(readPendingDesign({ storage })).toBeNull();
    queryClient.clear();
  });

  it("승인되지 않은 stale generation은 과금 요청과 marker를 만들지 않는다", async () => {
    api.generate.mockResolvedValue({ data: generated });
    const { storage } = memoryStorage();
    const queryClient = new QueryClient();
    const { result } = renderHook(
      () =>
        useGenerateDesign({
          pendingStorage: storage,
          onSessionReady: () => false,
        }),
      { wrapper: queryWrapper(queryClient) },
    );

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          mode: "prompt",
          sessionId: "stale-session",
          prompt: "stale",
        }),
      ).rejects.toBeInstanceOf(StaleDesignOperationError);
    });

    expect(api.generate).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(readPendingDesign({ storage })).toBeNull();
    queryClient.clear();
  });
});
