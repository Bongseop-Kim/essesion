// @vitest-environment jsdom

import type { DesignSessionOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@essesion/api-client/query", () => ({
  getDesignSessionOptions: () => ({ queryKey: ["design-session"] }),
  getDesignSessionQueryKey: ({ path }: { path: { session_id: string } }) => [
    "design-session",
    path.session_id,
  ],
  getTokenBalanceQueryKey: () => ["token-balance"],
  listDesignSessionsOptions: () => ({ queryKey: ["design-sessions"] }),
  listDesignSessionsQueryKey: () => ["design-sessions"],
  listDesignTurnsOptions: () => ({ queryKey: ["design-turns"] }),
  listDesignTurnsQueryKey: ({ path }: { path: { session_id: string } }) => [
    "design-turns",
    path.session_id,
  ],
  listGenerationJobsInfiniteOptions: () => ({ queryKey: ["generation-jobs"] }),
}));

import { DESIGN_PENDING_KEY, writePendingDesign } from "./pending";
import { ACTIVE_GENERATION_WAIT_LIMIT_MS } from "./queries";
import { useActiveGeneration } from "./use-active-generation";

const RUN = "11111111-1111-4111-8111-111111111111";

function sessionOut(overrides: Partial<DesignSessionOut>): DesignSessionOut {
  return {
    id: "session-1",
    status: "active",
    seed: null,
    colorway: null,
    registry_version: null,
    current_intent: null,
    current_plan: null,
    current_motifs: [],
    context_version: 1,
    active_generation_id: null,
    active_generation_started_at: null,
    created_at: "2026-09-08T00:00:00Z",
    updated_at: "2026-09-08T00:00:00Z",
    ...overrides,
  } as DesignSessionOut;
}

const running = (startedAt = new Date().toISOString()) =>
  sessionOut({
    active_generation_id: RUN,
    active_generation_started_at: startedAt,
  });

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function setup(sessionId: string | null) {
  const queryClient = new QueryClient();
  const invalidated = vi.spyOn(queryClient, "invalidateQueries");
  const onSettled = vi.fn();
  const view = renderHook(
    (props: {
      sessionId: string | null;
      session: DesignSessionOut | undefined;
    }) => useActiveGeneration({ ...props, onSettled }),
    {
      initialProps: {
        sessionId,
        session: undefined as DesignSessionOut | undefined,
      },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    },
  );
  return { invalidated, onSettled, queryClient, ...view };
}

function keys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) =>
    JSON.stringify((call[0] as { queryKey?: unknown } | undefined)?.queryKey),
  );
}

describe("useActiveGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("새로고침으로 mutation을 잃어도 서버 완료를 이력·잔액에 반영한다", async () => {
    writePendingDesign("session-1");
    const { invalidated, onSettled, queryClient, rerender, result } =
      setup("session-1");

    rerender({ sessionId: "session-1", session: running() });
    expect(result.current.recovering).toBe(true);
    // 진행 중에는 지우지 않는다 — 서버가 종료를 응답할 때까지 표시를 지킨다.
    expect(localStorage.getItem(DESIGN_PENDING_KEY)).toBeTruthy();

    rerender({ sessionId: "session-1", session: sessionOut({}) });

    expect(result.current.recovering).toBe(false);
    await waitFor(() =>
      expect(keys(invalidated)).toEqual([
        '["design-turns","session-1"]',
        '["token-balance"]',
        '["design-sessions"]',
      ]),
    );
    expect(onSettled).toHaveBeenCalled();
    expect(localStorage.getItem(DESIGN_PENDING_KEY)).toBeNull();
    queryClient.clear();
  });

  it("이미 완료된 세션은 한 번의 조회로 복구를 끝낸다", async () => {
    const { invalidated, onSettled, queryClient, rerender, result } =
      setup("session-1");

    rerender({ sessionId: "session-1", session: sessionOut({}) });

    expect(result.current).toEqual({ recovering: false, expired: false });
    // 진행 중인 걸 본 적이 없으므로 재조회는 하지 않는다.
    expect(keys(invalidated)).toEqual([]);
    expect(onSettled).toHaveBeenCalled();
    queryClient.clear();
  });

  it("세션을 바꾸면 이전 세션의 종료를 새 세션에 적용하지 않는다", async () => {
    const { invalidated, queryClient, rerender } = setup("session-1");

    rerender({ sessionId: "session-1", session: running() });
    rerender({ sessionId: "session-2", session: sessionOut({ id: "s2" }) });

    expect(keys(invalidated)).toEqual([]);
    queryClient.clear();
  });

  it("대기 상한을 넘긴 생성은 기다리지 않고 재확인으로 넘긴다", async () => {
    const { queryClient, rerender, result } = setup("session-1");
    const startedAt = new Date(
      Date.now() - ACTIVE_GENERATION_WAIT_LIMIT_MS - 1_000,
    ).toISOString();

    rerender({ sessionId: "session-1", session: running(startedAt) });

    await waitFor(() =>
      expect(result.current).toEqual({ recovering: false, expired: true }),
    );
    queryClient.clear();
  });
});
