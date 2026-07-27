import type {
  GenerationJobStatsOut,
  PageGenerationJobSummaryOut,
} from "@essesion/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  jobs: vi.fn(),
  jobStats: vi.fn(),
  jobOptions: vi.fn(),
  jobStatsOptions: vi.fn(),
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
}));

import { GenerationJobsPage } from "./jobs-list";

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
  succeeded: 46,
  failed: 1,
  canceled: 1,
  average_attempts: 1.2,
  as_of: "2026-07-12T01:00:00Z",
};

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <span data-testid="location-pathname">{location.pathname}</span>
      <span data-testid="location-search">{location.search}</span>
    </>
  );
}

function renderPage(entry = "/generation-jobs") {
  return renderAdminPage(
    <>
      <GenerationJobsPage />
      <LocationProbe />
    </>,
    { entry },
  );
}

describe("GenerationJobsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.jobs.mockResolvedValue(jobsPage);
    api.jobStats.mockResolvedValue(jobStats);
  });

  it("URL 필터와 안정 페이지 offset을 생성 클라이언트에 전달한다", async () => {
    renderPage(
      "/generation-jobs?page=2&limit=50&status=failed&type=export&from=2026-07-01&to=2026-07-12",
    );

    expect(
      await screen.findByRole("table", { name: "생성 작업 목록" }),
    ).toBeTruthy();
    await screen.findByText("11111111…1111");
    expect(
      within(
        screen.getByRole("row", {
          name: /11111111-1111-4111-8111-111111111111/,
        }),
      ).getByText("실패"),
    ).toBeTruthy();
    expect(api.jobOptions).toHaveBeenCalledWith({
      query: {
        job_id: undefined,
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
      screen.getByRole("button", { name: "상태: 실패 필터 제거" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "작업 단계: 파일 내보내기 필터 제거",
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "2페이지" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("작업 ID 링크를 키보드로 열 수 있다", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderPage();

    const link = await screen.findByRole("link", {
      name: "작업 ID 11111111-1111-4111-8111-111111111111",
    });
    await user.click(screen.getByRole("button", { name: "작업 ID 복사" }));
    expect(writeText).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    link.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("location-pathname").textContent).toBe(
      "/generation-jobs/11111111-1111-4111-8111-111111111111",
    );
  });

  it("작업 ID를 정확히 검증해 목록과 통계에 적용하고 제거 시 입력을 비운다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "생성 작업 목록" });

    const input = screen.getByLabelText("작업 ID 검색") as HTMLInputElement;
    const toolbar = screen.getByRole("region", { name: "목록 필터" });
    expect((toolbar.firstElementChild as HTMLElement).style.flex).toBe(
      "1 1 0%",
    );

    await user.type(input, "invalid-id");
    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(screen.getByText("작업 ID는 UUID 형식이어야 합니다.")).toBeTruthy();
    expect(api.jobOptions).not.toHaveBeenCalledWith({
      query: expect.objectContaining({ job_id: "invalid-id" }),
    });

    const jobId = "33333333-3333-4333-8333-333333333333";
    await user.clear(input);
    await user.type(input, jobId);
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() =>
      expect(api.jobOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ job_id: jobId, offset: 0 }),
      }),
    );
    expect(api.jobStatsOptions).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ job_id: jobId }),
    });
    expect(screen.getByTestId("location-search").textContent).not.toContain(
      jobId,
    );

    await user.click(
      screen.getByRole("button", {
        name: `작업 ID: ${jobId} 필터 제거`,
      }),
    );

    await waitFor(() => expect(input.value).toBe(""));
    expect(screen.queryByRole("button", { name: "검색 초기화" })).toBeNull();
    await waitFor(() =>
      expect(api.jobOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ job_id: undefined, offset: 0 }),
      }),
    );
  });

  it("사용자 식별자를 URL에 남기지 않고 요청에만 적용한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "생성 작업 목록" });

    const userId = "33333333-3333-4333-8333-333333333333";
    await user.click(screen.getByRole("button", { name: "필터" }));
    const dialog = screen.getByRole("dialog", { name: "생성 작업 필터" });
    await user.click(within(dialog).getByLabelText("사용자 ID"));
    await user.paste(userId);
    await user.click(within(dialog).getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.jobOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ user_id: userId, offset: 0 }),
      }),
    );
    expect(screen.getByTestId("location-search").textContent).not.toContain(
      userId,
    );
    expect(
      screen.getByRole("button", {
        name: `사용자 ID: ${userId} 필터 제거`,
      }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "전체 초기화" }));

    expect(screen.queryByRole("group", { name: "적용된 필터" })).toBeNull();
    expect(screen.getByTestId("location-search").textContent).not.toContain(
      userId,
    );
    await waitFor(() =>
      expect(api.jobOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ user_id: undefined, offset: 0 }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "필터" }));
    expect(
      (
        within(
          screen.getByRole("dialog", { name: "생성 작업 필터" }),
        ).getByLabelText("사용자 ID") as HTMLInputElement
      ).value,
    ).toBe("");
  });

  it("상태를 포함한 필터 초안은 취소하면 버리고 적용할 때만 URL과 요청을 바꾼다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "생성 작업 목록" });

    await user.click(screen.getByRole("button", { name: "필터" }));
    let dialog = screen.getByRole("dialog", { name: "생성 작업 필터" });
    await user.click(within(dialog).getByRole("radio", { name: "실패" }));
    await user.click(
      within(dialog).getByRole("radio", { name: "파일 내보내기" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "취소" }));

    expect(screen.getByTestId("location-search").textContent).not.toContain(
      "type=export",
    );
    expect(screen.getByTestId("location-search").textContent).not.toContain(
      "status=failed",
    );
    expect(api.jobOptions).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ kind: undefined, status: undefined }),
    });

    await user.click(screen.getByRole("button", { name: "필터" }));
    dialog = screen.getByRole("dialog", { name: "생성 작업 필터" });
    await user.click(within(dialog).getByRole("radio", { name: "실패" }));
    await user.click(
      within(dialog).getByRole("radio", { name: "파일 내보내기" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(screen.getByTestId("location-search").textContent).toContain(
        "type=export",
      ),
    );
    expect(screen.getByTestId("location-search").textContent).toContain(
      "status=failed",
    );
    await waitFor(() =>
      expect(api.jobOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          kind: "export",
          status: "failed",
          offset: 0,
        }),
      }),
    );
  });

  it("마지막 성공 갱신을 표시하고 자동 갱신을 일시정지·재개한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "생성 작업 목록" });

    const refreshStatus = screen.getByRole("group", {
      name: "생성 작업 갱신 상태",
    });
    expect(within(refreshStatus).getByText("자동 갱신 켜짐")).toBeTruthy();
    await waitFor(() =>
      expect(
        within(refreshStatus).getByRole("status").textContent,
      ).not.toContain("아직 없음"),
    );

    await user.click(
      within(refreshStatus).getByRole("button", {
        name: "자동 갱신 일시정지",
      }),
    );
    expect(
      within(refreshStatus).getByText("자동 갱신 일시정지됨"),
    ).toBeTruthy();

    const jobCalls = api.jobs.mock.calls.length;
    const statsCalls = api.jobStats.mock.calls.length;

    await user.click(
      within(refreshStatus).getByRole("button", { name: "자동 갱신 재개" }),
    );

    expect(within(refreshStatus).getByText("자동 갱신 켜짐")).toBeTruthy();
    await waitFor(() => {
      expect(api.jobs.mock.calls.length).toBeGreaterThan(jobCalls);
      expect(api.jobStats.mock.calls.length).toBeGreaterThan(statsCalls);
    });
  });
});
