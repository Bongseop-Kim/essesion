// @vitest-environment jsdom

import { listDesignSessionsQueryKey } from "@essesion/api-client/query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@essesion/api-client", () => ({
  selectDesignCandidate: api.select,
}));

import { designSessionQueryKey, designTurnsQueryKey } from "./queries";
import { useDesignSelection } from "./use-selection";

function queryWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("design selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("후보를 정본으로 커밋하고 세션·턴 쿼리를 갱신한다", async () => {
    const session = { id: "session-1", current_intent: { motif: "bee" } };
    api.select.mockResolvedValue({ data: session });
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useDesignSelection(), {
      wrapper: queryWrapper(queryClient),
    });

    await act(async () => {
      const selected = await result.current.mutateAsync({
        sessionId: "session-1",
        runId: "11111111-1111-4111-8111-111111111111",
        candidate: {
          id: "candidate-1",
          design_index: 0,
          seed: 7,
          colorway_id: "default",
          svg: "<svg/>",
        },
      });
      expect(selected.session).toBe(session);
    });

    expect(api.select).toHaveBeenCalledWith({
      path: { session_id: "session-1" },
      body: {
        run_id: "11111111-1111-4111-8111-111111111111",
        candidate_id: "candidate-1",
      },
      throwOnError: true,
    });
    for (const queryKey of [
      listDesignSessionsQueryKey(),
      designSessionQueryKey("session-1"),
      designTurnsQueryKey("session-1"),
    ]) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey });
    }
  });
});
