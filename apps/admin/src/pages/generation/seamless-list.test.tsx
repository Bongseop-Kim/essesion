import type {
  PageSeamlessSummaryOut,
  SeamlessStatsOut,
} from "@essesion/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  seamless: vi.fn(),
  seamlessStats: vi.fn(),
  seamlessOptions: vi.fn(),
  seamlessStatsOptions: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
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

import { SeamlessLogsPage } from "./seamless-list";

const seamlessPage: PageSeamlessSummaryOut = {
  items: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      request_id: "request-2",
      input_type: "intent",
      status: "partial",
      warning_count: 1,
      generate_ms: 100,
      render_ms: 25,
      engine_version: "1.0",
      registry_version: "v1",
      error_type: null,
      error_summary: null,
      failure_code: null,
      failure_stage: null,
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
  recraft_calls: 4,
  average_generate_ms: 100,
  average_render_ms: 25,
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

function renderPage(entry = "/seamless-logs") {
  return renderAdminPage(
    <>
      <SeamlessLogsPage />
      <LocationProbe />
    </>,
    { entry },
  );
}

describe("SeamlessLogsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.seamless.mockResolvedValue(seamlessPage);
    api.seamlessStats.mockResolvedValue(seamlessStats);
  });

  it("Seamless 전용 목록·통계를 조회하고 상태 필터를 URL에 반영한다", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("table", { name: "Seamless 로그 목록" }),
    ).toBeTruthy();
    await screen.findByText("22222222…2222");
    expect(
      within(
        screen.getByRole("row", {
          name: /22222222-2222-4222-8222-222222222222/,
        }),
      ).getByText("부분 성공"),
    ).toBeTruthy();
    expect(screen.getByText("Recraft 호출")).toBeTruthy();
    expect(screen.getByText("4회")).toBeTruthy();
    expect(api.seamlessOptions).toHaveBeenCalledWith({
      query: {
        status: undefined,
        identifier: undefined,
        start: undefined,
        end: undefined,
        limit: 20,
        offset: 0,
      },
    });
    expect(api.seamlessStatsOptions).toHaveBeenCalled();

    expect(screen.queryByRole("radiogroup", { name: "상태" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "필터" }));
    const dialog = screen.getByRole("dialog", { name: "Seamless 상세 필터" });
    expect(within(dialog).queryByLabelText("식별자 검색")).toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: "부분 성공" }));
    await user.click(within(dialog).getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.seamlessOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ status: "partial", offset: 0 }),
      }),
    );
    expect(screen.getByTestId("location-search").textContent).toContain(
      "status=partial",
    );
  });

  it("로그 ID 링크를 키보드로 열 수 있다", async () => {
    const user = userEvent.setup();
    renderPage();

    const link = await screen.findByRole("link", {
      name: "로그 ID 22222222-2222-4222-8222-222222222222",
    });
    link.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("location-pathname").textContent).toBe(
      "/seamless-logs/22222222-2222-4222-8222-222222222222",
    );
  });

  it("식별자 검색을 목록과 통계에 적용하고 전체 초기화한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Seamless 로그 목록" });

    const input = screen.getByLabelText("식별자 검색") as HTMLInputElement;
    await user.type(input, "request/id");
    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(screen.getByText("식별자 형식이 올바르지 않습니다.")).toBeTruthy();
    expect(api.seamlessOptions).not.toHaveBeenCalledWith({
      query: expect.objectContaining({ identifier: "request/id" }),
    });

    const requestId = "request-2";
    await user.clear(input);
    await user.type(input, requestId);
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() =>
      expect(api.seamlessOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ identifier: requestId, offset: 0 }),
      }),
    );
    expect(api.seamlessStatsOptions).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ identifier: requestId }),
    });
    expect(screen.getByTestId("location-search").textContent).not.toContain(
      requestId,
    );

    await user.click(screen.getByRole("button", { name: "전체 초기화" }));

    await waitFor(() => expect(input.value).toBe(""));
    expect(screen.queryByRole("button", { name: "검색 초기화" })).toBeNull();
    await waitFor(() =>
      expect(api.seamlessOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ identifier: undefined, offset: 0 }),
      }),
    );
  });

  it("마지막 성공 갱신을 표시하고 자동 갱신을 일시정지·재개한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Seamless 로그 목록" });

    const refreshStatus = screen.getByRole("group", {
      name: "Seamless 로그 갱신 상태",
    });
    expect(within(refreshStatus).getByText("자동 갱신 켜짐")).toBeTruthy();
    await waitFor(() =>
      expect(
        within(refreshStatus).getByRole("status").textContent,
      ).not.toContain("아직 없음"),
    );

    await user.click(
      within(refreshStatus).getByRole("button", { name: "자동 갱신 일시정지" }),
    );
    expect(
      within(refreshStatus).getByText("자동 갱신 일시정지됨"),
    ).toBeTruthy();

    const seamlessCalls = api.seamless.mock.calls.length;
    const statsCalls = api.seamlessStats.mock.calls.length;

    await user.click(
      within(refreshStatus).getByRole("button", { name: "자동 갱신 재개" }),
    );

    expect(within(refreshStatus).getByText("자동 갱신 켜짐")).toBeTruthy();
    await waitFor(() => {
      expect(api.seamless.mock.calls.length).toBeGreaterThan(seamlessCalls);
      expect(api.seamlessStats.mock.calls.length).toBeGreaterThan(statsCalls);
    });
  });
});
