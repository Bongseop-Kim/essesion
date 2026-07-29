// @vitest-environment jsdom

import { listDesignSessionsQueryKey } from "@essesion/api-client/query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  branch: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@essesion/api-client", () => ({
  branchDesignSession: api.branch,
  selectDesignCandidate: api.select,
}));

import { useDesignBranch } from "./use-selection";

function queryWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("design branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("과거 후보로 새 세션을 만들고 세션 목록을 갱신한다", async () => {
    const session = { id: "branched-session" };
    api.branch.mockResolvedValue({ data: session });
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useDesignBranch(), {
      wrapper: queryWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        sessionId: "source-session",
        runId: "11111111-1111-4111-8111-111111111111",
        candidate: {
          id: "candidate-1",
          design_index: 0,
          seed: 7,
          colorway_id: "default",
          svg: "<svg/>",
        },
      });
    });

    expect(api.branch).toHaveBeenCalledWith({
      path: { session_id: "source-session" },
      body: {
        run_id: "11111111-1111-4111-8111-111111111111",
        candidate_id: "candidate-1",
      },
      throwOnError: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: listDesignSessionsQueryKey(),
    });
  });
});
