// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FinalizeDialogValue } from "@/features/design/ui/finalize-dialog";

const api = vi.hoisted(() => ({
  createFinalizeJob: vi.fn(),
  appendDesignTurn: vi.fn(),
  exportDesign: vi.fn(),
}));
const ui = vi.hoisted(() => ({ snackbar: vi.fn() }));

vi.mock("@essesion/api-client", () => ({
  appendDesignTurn: api.appendDesignTurn,
  createFinalizeJob: api.createFinalizeJob,
  exportDesign: api.exportDesign,
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
  listGenerationJobsQueryKey: () => ["generation-jobs"],
}));

vi.mock("@essesion/shared", () => ({ snackbar: ui.snackbar }));

import { useFinalizeFlow } from "./use-design-output";

const REQUEST: FinalizeDialogValue = {
  productionMethod: "print",
  weave: "twill-0",
  dpi: 300,
};

function queryWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidated = vi.spyOn(queryClient, "invalidateQueries");
  const { result } = renderHook(
    () => useFinalizeFlow({ sessionId: "session-1", onDone: vi.fn() }),
    { wrapper: queryWrapper(queryClient) },
  );
  return { queryClient, invalidated, result };
}

function invalidatedKeys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) =>
    JSON.stringify((call[0] as { queryKey?: unknown } | undefined)?.queryKey),
  );
}

describe("useFinalizeFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("실사화 성공 뒤 잔액을 다시 조회한다", async () => {
    api.createFinalizeJob.mockResolvedValue({ data: { id: "job-1" } });
    api.appendDesignTurn.mockResolvedValue({ data: {} });
    const { queryClient, invalidated, result } = setup();

    result.current.submit(REQUEST);

    await waitFor(() =>
      expect(invalidatedKeys(invalidated)).toContain('["token-balance"]'),
    );
    expect(invalidatedKeys(invalidated)).toContain('["generation-jobs"]');
    queryClient.clear();
  });

  it("실사화 실패로 환불됐을 때도 잔액을 다시 조회한다", async () => {
    api.createFinalizeJob.mockRejectedValue({ code: "upstream_error" });
    const { queryClient, invalidated, result } = setup();

    result.current.submit(REQUEST);

    await waitFor(() => expect(ui.snackbar).toHaveBeenCalled());
    expect(invalidatedKeys(invalidated)).toEqual(['["token-balance"]']);
    queryClient.clear();
  });
});
