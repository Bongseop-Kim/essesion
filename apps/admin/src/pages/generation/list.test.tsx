import type {
  GenerationJobStatsOut,
  PageGenerationJobSummaryOut,
  PageSeamlessSummaryOut,
  SeamlessStatsOut,
} from "@essesion/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  jobs: vi.fn(),
  jobStats: vi.fn(),
  seamless: vi.fn(),
  seamlessStats: vi.fn(),
  jobOptions: vi.fn(),
  jobStatsOptions: vi.fn(),
  seamlessOptions: vi.fn(),
  seamlessStatsOptions: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  listAdminGenerationJobsOptions: (options: unknown) => {
    api.jobOptions(options);
    return {
      queryKey: ["generation-jobs", JSON.stringify(options)],
      queryFn: api.jobs,
    };
  },
  getAdminGenerationJobStatsOptions: (options: unknown) => {
    api.jobStatsOptions(options);
    return {
      queryKey: ["generation-job-stats", JSON.stringify(options)],
      queryFn: api.jobStats,
    };
  },
  listAdminSeamlessLogsOptions: (options: unknown) => {
    api.seamlessOptions(options);
    return {
      queryKey: ["seamless-logs", JSON.stringify(options)],
      queryFn: api.seamless,
    };
  },
  getAdminSeamlessStatsOptions: (options: unknown) => {
    api.seamlessStatsOptions(options);
    return {
      queryKey: ["seamless-stats", JSON.stringify(options)],
      queryFn: api.seamlessStats,
    };
  },
}));

import { GenerationOperationsPage } from "./list";

const jobsPage: PageGenerationJobSummaryOut = {
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "export",
      status: "failed",
      attempts: 2,
      request_id: "request-1",
      result_available: false,
      error_summary: "생성 작업에 실패했습니다",
      created_at: "2026-07-11T01:00:00Z",
      updated_at: "2026-07-11T01:00:03Z",
    },
  ],
  total: 51,
  limit: 50,
  offset: 50,
};

const jobStats: GenerationJobStatsOut = {
  total: 51,
  queued: 1,
  processing: 2,
  succeeded: 47,
  failed: 1,
  average_attempts: 1.2,
  as_of: "2026-07-12T01:00:00Z",
};

const seamlessPage: PageSeamlessSummaryOut = {
  items: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      request_id: "request-2",
      input_type: "intent",
      status: "partial",
      candidate_count_requested: 4,
      candidate_count_returned: 3,
      distinct_layouts: 2,
      warning_count: 1,
      generate_ms: 100,
      render_ms: 25,
      engine_version: "1.0",
      registry_version: "v1",
      error_type: null,
      error_summary: null,
      created_at: "2026-07-12T01:00:00Z",
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

const seamlessStats: SeamlessStatsOut = {
  total: 1,
  success: 0,
  partial: 1,
  error: 0,
  average_generate_ms: 100,
  average_render_ms: 25,
  as_of: "2026-07-12T01:00:00Z",
};

function LocationProbe() {
  return <span data-testid="location-search">{useLocation().search}</span>;
}

function renderPage(entry = "/generation-logs?tab=jobs") {
  return renderAdminPage(
    <>
      <GenerationOperationsPage />
      <LocationProbe />
    </>,
    { entry },
  );
}

describe("GenerationOperationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.jobs.mockResolvedValue(jobsPage);
    api.jobStats.mockResolvedValue(jobStats);
    api.seamless.mockResolvedValue(seamlessPage);
    api.seamlessStats.mockResolvedValue(seamlessStats);
  });

  it("작업 탭 URL 필터와 안정 페이지 offset을 생성 클라이언트에 전달한다", async () => {
    renderPage(
      "/generation-logs?tab=jobs&page=2&limit=50&status=failed&type=export&from=2026-07-01&to=2026-07-12",
    );

    expect(
      await screen.findByRole("table", { name: "생성 작업 목록" }),
    ).toBeTruthy();
    await screen.findByText("11111111-1111-4111-8111-111111111111");
    expect(api.jobOptions).toHaveBeenCalledWith({
      query: {
        kind: "export",
        status: "failed",
        user_id: undefined,
        start: "2026-07-01T00:00:00+09:00",
        end: "2026-07-12T23:59:59.999+09:00",
        limit: 50,
        offset: 50,
      },
    });
    expect(
      screen
        .getByRole("button", { name: "2페이지" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("사용자 식별자를 URL에 남기지 않고 작업 탭 요청에만 적용한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "생성 작업 목록" });

    const userId = "33333333-3333-4333-8333-333333333333";
    await user.type(screen.getByLabelText("사용자 ID"), userId);
    await user.click(screen.getByRole("button", { name: "사용자 적용" }));

    await waitFor(() =>
      expect(api.jobOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ user_id: userId, offset: 0 }),
      }),
    );
    expect(screen.getByTestId("location-search").textContent).not.toContain(
      userId,
    );
  });

  it("탭 선택을 URL에 반영하고 Seamless 전용 목록·통계를 조회한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "생성 작업 목록" });

    await user.click(screen.getByRole("tab", { name: "Seamless" }));

    expect(
      await screen.findByRole("table", { name: "Seamless 로그 목록" }),
    ).toBeTruthy();
    expect(screen.getByTestId("location-search").textContent).toContain(
      "tab=seamless",
    );
    expect(api.seamlessOptions).toHaveBeenCalledWith({
      query: {
        status: undefined,
        request_id: undefined,
        start: undefined,
        end: undefined,
        limit: 20,
        offset: 0,
      },
    });
    expect(api.seamlessStatsOptions).toHaveBeenCalled();
  });
});
