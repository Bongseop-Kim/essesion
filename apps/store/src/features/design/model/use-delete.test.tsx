// @vitest-environment jsdom

import {
  listDesignSessionsQueryKey,
  listGenerationJobsQueryKey,
} from "@essesion/api-client/query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  deleteJob: vi.fn(),
}));

vi.mock("@essesion/api-client", () => ({
  deleteDesignSession: api.deleteSession,
  deleteGenerationJob: api.deleteJob,
}));

import {
  designSessionQueryKey,
  designTurnsQueryKey,
  generationJobQueryKey,
} from "./queries";
import { useDeleteDesignSession, useDeleteFinalizedJob } from "./use-delete";

function queryWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("design deletion cache updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.deleteSession.mockResolvedValue({});
    api.deleteJob.mockResolvedValue({});
  });

  it("세션 삭제 후 세션·턴 캐시를 제거하고 세션·잡 목록을 갱신한다", async () => {
    const queryClient = new QueryClient();
    const removeQueries = vi
      .spyOn(queryClient, "removeQueries")
      .mockImplementation(() => {});
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteDesignSession(), {
      wrapper: queryWrapper(queryClient),
    });
    const sessionId = "session-1";

    await act(async () => {
      await result.current.mutateAsync(sessionId);
    });

    expect(api.deleteSession).toHaveBeenCalledWith({
      path: { session_id: sessionId },
      throwOnError: true,
    });
    expect(removeQueries).toHaveBeenNthCalledWith(1, {
      queryKey: designSessionQueryKey(sessionId),
    });
    expect(removeQueries).toHaveBeenNthCalledWith(2, {
      queryKey: designTurnsQueryKey(sessionId),
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: listDesignSessionsQueryKey(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: listGenerationJobsQueryKey(),
    });
  });

  it("완성본 삭제 후 단건 캐시를 제거하고 잡 목록만 갱신한다", async () => {
    const queryClient = new QueryClient();
    const removeQueries = vi
      .spyOn(queryClient, "removeQueries")
      .mockImplementation(() => {});
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteFinalizedJob(), {
      wrapper: queryWrapper(queryClient),
    });
    const jobId = "job-1";

    await act(async () => {
      await result.current.mutateAsync(jobId);
    });

    expect(api.deleteJob).toHaveBeenCalledWith({
      path: { job_id: jobId },
      throwOnError: true,
    });
    expect(removeQueries).toHaveBeenCalledOnce();
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: generationJobQueryKey(jobId),
    });
    expect(invalidateQueries).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: listGenerationJobsQueryKey(),
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: listDesignSessionsQueryKey(),
    });
  });
});
