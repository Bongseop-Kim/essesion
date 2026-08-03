import type { MotifDetailOut, PageMotifSummaryOut } from "@essesion/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  review: vi.fn(),
  listOptions: vi.fn(),
  detailOptions: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "admin" as "admin" | "manager" }));

vi.mock("@essesion/api-client/query", () => ({
  listAdminMotifsOptions: (options: unknown) => {
    api.listOptions(options);
    return {
      queryKey: ["motifs", JSON.stringify(options)],
      queryFn: api.list,
    };
  },
  getAdminMotifOptions: (options: unknown) => {
    api.detailOptions(options);
    return {
      queryKey: ["motif-detail", JSON.stringify(options)],
      queryFn: api.detail,
    };
  },
  getAdminMotifQueryKey: (options: unknown) => [
    "motif-detail",
    JSON.stringify(options),
  ],
  listAdminMotifsQueryKey: () => ["motifs"],
  reviewAdminMotifMutation: () => ({ mutationFn: api.review }),
}));

vi.mock("../../shared/session/admin-session", () => ({
  useAdminSession: () => ({
    state: {
      status: "authenticated",
      session: { userId: "admin-1", displayName: "운영자", role: auth.role },
    },
  }),
}));

import { MotifDetailPage, motifPreviewDocument } from "./detail";
import { MotifsPage } from "./list";

const page: PageMotifSummaryOut = {
  items: [
    {
      id: "motif-1",
      subject: "동백꽃",
      scope: "whole",
      view: "front",
      expression: "flat",
      style: "line",
      source: "registry",
      variant_group: "flowers",
      status: "pending",
      reviewed_at: null,
      created_at: "2026-07-12T01:00:00Z",
      bbox: [0, 0, 24, 24],
      symbol:
        '<symbol id="motif-1"><path fill="#C0445A" d="M0 0h24v24H0z"/></symbol>',
      svg_status: "safe",
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

const detail: MotifDetailOut = {
  ...page.items[0]!,
  description: "정면 동백꽃 모티프",
  tags: ["flower", "camellia"],
  anchor: [12, 12],
};

const createObjectURL = vi.fn(() => "blob:motif-preview");
const revokeObjectURL = vi.fn();

function renderPage(entry = "/motifs") {
  return renderAdminPage(<MotifsPage />, { entry });
}

describe("MotifsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    api.list.mockResolvedValue(page);
    api.detail.mockResolvedValue(detail);
    api.review.mockResolvedValue({
      ...detail,
      status: "approved",
      reviewed_at: "2026-08-03T08:00:00Z",
    });
  });

  it("scope 필터와 페이지를 생성 클라이언트에 전달한다", async () => {
    renderPage("/motifs?type=whole&page=2&limit=50");

    expect(
      await screen.findByRole("table", { name: "Motif 목록" }),
    ).toBeTruthy();
    expect(api.listOptions).toHaveBeenCalledWith({
      query: {
        status: "pending",
        scope: "whole",
        q: undefined,
        start_date: undefined,
        end_date: undefined,
        limit: 50,
        offset: 50,
      },
    });
  });

  it("목록의 Motif 이름이 상세 페이지로 링크된다", async () => {
    renderPage();

    const link = await screen.findByRole("link", { name: "동백꽃" });
    expect(link.getAttribute("href")).toBe("/motifs/motif-1");
  });

  it("safe symbol을 목록에서 미리보기 이미지로 보여준다", async () => {
    renderPage();

    const img = await screen.findByRole("img", { name: "동백꽃 미리보기" });
    expect(img.getAttribute("src")).toContain("data:image/svg+xml");
    expect(img.getAttribute("src")).toContain(encodeURIComponent("<svg"));
  });

  it("검색과 생성일 필터를 적용하고 칩·전체 초기화로 해제한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Motif 목록" });

    await user.type(
      screen.getByLabelText("Motif ID·이름·소스 검색"),
      "motif-1",
    );
    await user.click(screen.getByRole("button", { name: "검색" }));
    await waitFor(() =>
      expect(api.listOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ q: "motif-1", offset: 0 }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "필터" }));
    await user.type(screen.getByLabelText("시작일 (KST)"), "2026-07-01");
    await user.type(screen.getByLabelText("종료일 (KST)"), "2026-07-12");
    await user.click(screen.getByRole("button", { name: "필터 적용" }));
    await waitFor(() =>
      expect(api.listOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          q: "motif-1",
          start_date: "2026-07-01",
          end_date: "2026-07-12",
          offset: 0,
        }),
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "검색: motif-1 필터 제거",
      }),
    );
    await waitFor(() =>
      expect(api.listOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          q: undefined,
          start_date: "2026-07-01",
          end_date: "2026-07-12",
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    await waitFor(() =>
      expect(api.listOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          q: undefined,
          start_date: undefined,
          end_date: undefined,
        }),
      }),
    );
    expect(
      (screen.getByLabelText("Motif ID·이름·소스 검색") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("범위 필터 초안은 취소하면 버리고 적용할 때 조회한다", async () => {
    const user = userEvent.setup();
    renderPage("/motifs?type=whole");
    await screen.findByRole("table", { name: "Motif 목록" });

    const requestCount = api.list.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "필터 1" }));
    await user.click(screen.getByRole("radio", { name: "부분 모티프" }));
    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(api.list).toHaveBeenCalledTimes(requestCount);

    await user.click(screen.getByRole("button", { name: "필터 1" }));
    expect(
      (
        screen.getByRole("radio", {
          name: "전체 모티프",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    await user.click(screen.getByRole("radio", { name: "부분 모티프" }));
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.listOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ scope: "partial", offset: 0 }),
      }),
    );
  });

  it("검토 대기를 기본 조회하고 상태 필터를 적용한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Motif 목록" });

    await user.click(screen.getByRole("button", { name: "필터" }));
    await user.click(screen.getByRole("radio", { name: "승인" }));
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.listOptions).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ status: "approved", offset: 0 }),
      }),
    );
  });
});

describe("MotifDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    api.detail.mockResolvedValue(detail);
    api.review.mockResolvedValue({
      ...detail,
      status: "approved",
      reviewed_at: "2026-08-03T08:00:00Z",
    });
  });

  it("safe symbol을 Blob 이미지로 표현한다", async () => {
    renderAdminPage(
      <Routes>
        <Route path="/motifs/:motifId" element={<MotifDetailPage />} />
      </Routes>,
      { entry: "/motifs/motif-1" },
    );

    expect(
      await screen.findByRole("img", {
        name: "동백꽃 Motif 안전 미리보기",
      }),
    ).toBeTruthy();
    expect(api.detailOptions).toHaveBeenCalledWith({
      path: { motif_id: "motif-1" },
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByText("정면 동백꽃 모티프")).toBeTruthy(),
    );
  });

  it("모티프 메타데이터 행 집합을 그대로 노출한다", async () => {
    const { container } = renderAdminPage(
      <Routes>
        <Route path="/motifs/:motifId" element={<MotifDetailPage />} />
      </Routes>,
      { entry: "/motifs/motif-1" },
    );

    await screen.findByText("정면 동백꽃 모티프");
    expect(
      Array.from(container.querySelectorAll("dt"), (node) => node.textContent),
    ).toEqual([
      "주제",
      "범위",
      "뷰",
      "표현",
      "스타일",
      "소스",
      "검토 상태",
      "검토 시각",
      "품질",
      "변형 그룹",
      "생성일",
      "bbox",
      "anchor",
    ]);
  });

  it("승인 확인 후 생성 클라이언트로 검토 상태를 변경한다", async () => {
    const user = userEvent.setup();
    renderAdminPage(
      <Routes>
        <Route path="/motifs/:motifId" element={<MotifDetailPage />} />
      </Routes>,
      { entry: "/motifs/motif-1" },
    );
    await screen.findByText("정면 동백꽃 모티프");

    await user.click(screen.getByRole("button", { name: "승인" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "승인" }));

    await waitFor(() =>
      expect(api.review.mock.calls[0]?.[0]).toEqual({
        path: { motif_id: "motif-1" },
        body: { status: "approved" },
      }),
    );
    expect(screen.getAllByText("승인").length).toBeGreaterThan(0);
  });

  it("symbol fragment를 innerHTML 없이 독립 SVG 문서로 감싼다", () => {
    const preview = motifPreviewDocument(
      '<symbol id="motif-x"><path d="M0 0h1v1H0z"/></symbol>',
      [1, 2, 3, 4],
    );

    expect(preview?.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(
      true,
    );
    expect(preview).toContain('viewBox="0.88 1.88 2.24 2.24"');
    expect(preview?.endsWith("</svg>")).toBe(true);
  });

  it("symbol의 고정 색을 그대로 보존한다", () => {
    const preview = motifPreviewDocument(
      '<symbol id="motif-m"><path fill="#C0445A"/><path fill="#3E6FA8"/></symbol>',
      [0, 0, 1, 1],
    );

    expect(preview).toContain('fill="#C0445A"');
    expect(preview).toContain('fill="#3E6FA8"');
  });
});
