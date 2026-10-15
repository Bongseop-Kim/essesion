// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "@/shared/store/session";

const api = vi.hoisted(() => ({ startFromExample: vi.fn() }));
let examples: Record<string, unknown>[] = [];

vi.mock("@essesion/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/api-client")>()),
  createDesignSessionFromExample: api.startFromExample,
}));
vi.mock("@/features/auth/ui/auth-guard-provider", () => ({
  useAuthGuard: () => ({ requireAuth: () => true }),
}));

vi.mock("@essesion/api-client/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/api-client/query")>()),
  listDesignExamplesOptions: () => ({
    queryKey: ["page-templates-examples"],
    queryFn: async () => examples,
  }),
}));

import { DesignTemplatesPage } from "./templates";

function renderPage(state?: unknown) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter initialEntries={[{ pathname: "/design", state }]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/design" element={<DesignTemplatesPage />} />
          <Route path="/design/sessions/:id/color" element={<p>색 고르기</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("DesignTemplatesPage", () => {
  beforeEach(() => {
    examples = [];
    vi.clearAllMocks();
    // 칩 필터의 ScrollFog가 쓴다 — jsdom에는 없다.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useSession.setState({ status: "anonymous", accessToken: null, user: null });
  });

  it("로그인해도 세션을 열지 않고 템플릿 화면을 보여준다 — 0건이면 빈 상태 문구", async () => {
    useSession.setState({
      status: "authenticated",
      accessToken: "access-token",
      user: null,
    });
    renderPage();

    await screen.findByText("디자인 템플릿");
    await screen.findByText("준비된 템플릿이 아직 없어요");
    // 캔버스 컨트롤은 세션 주소에서만 나온다.
    expect(screen.queryByLabelText("무엇을 바꿀까요?")).toBeNull();
    expect(screen.queryByRole("button", { name: "실사화" })).toBeNull();
  });

  it("템플릿 행을 누르면 세션을 만들고 바로 색 선택으로 간다", async () => {
    api.startFromExample.mockResolvedValue({ data: { id: "session-2" } });
    examples = [
      {
        id: "example-1",
        name: "미드나잇 웨이브",
        caption: "네이비 · 대각 스트라이프",
        preview_svg: "<svg id='e1'/>",
        category: null,
        point: "none",
        logo_slot: null,
        photo_full_url: null,
        photo_detail_url: null,
        logo_preview_svg: null,
        colorways: [
          {
            id: "default",
            name: null,
            mapping: { g: "#10243a", a: "#c9a24b" },
          },
          {
            id: "preset_1",
            name: "네이비 · 골드",
            mapping: { g: "#1b2a49", a: "#c9a24b" },
          },
        ],
      },
    ];
    renderPage();

    const row = await screen.findByRole("button", {
      name: "미드나잇 웨이브 템플릿으로 시작",
    });
    expect(within(row).getByText("네이비 · 대각 스트라이프")).toBeTruthy();
    // 색 칩은 SVG에 쓰인 색이 아니라 색 고르기의 선택지(colorways)다.
    expect(within(row).getByText("배색 2종")).toBeTruthy();
    expect(
      within(row).getByRole("img", { name: "네이비 · 골드" }),
    ).toBeTruthy();
    // 올패턴 — 전체 샷 + 무늬 확대만. 포인트 확대(매듭·끝)는 포인트가 있을 때만.
    expect(
      within(row).getByRole("img", { name: "미드나잇 웨이브, 무늬 확대" }),
    ).toBeTruthy();
    expect(
      within(row).queryByRole("img", { name: "미드나잇 웨이브, 매듭 확대" }),
    ).toBeNull();
    // 보기만 하면 서버 호출이 없다.
    expect(api.startFromExample).not.toHaveBeenCalled();

    fireEvent.click(row);
    await waitFor(() =>
      expect(api.startFromExample).toHaveBeenCalledWith({
        body: { example_id: "example-1" },
        throwOnError: true,
      }),
    );
    await screen.findByText("색 고르기");
  });

  it("분류 칩은 템플릿 데이터의 category이고, 포인트·사진은 그 값대로 그린다", async () => {
    const base = {
      caption: null,
      preview_svg: "<svg id='e1'/>",
      logo_slot: 1,
      photo_full_url: null,
      photo_detail_url: null,
      logo_preview_svg: null,
      colorways: [],
    };
    examples = [
      { ...base, id: "a", name: "올패턴", category: "격자", point: "none" },
      {
        ...base,
        id: "b",
        name: "포인트",
        category: "스트라이프",
        point: "bottom",
        photo_full_url: "/templates/b/full.jpg",
        logo_preview_svg:
          '<svg><defs><symbol id="motif-x"><circle r="0.4"/></symbol></defs></svg>',
      },
    ];
    renderPage();

    const point = await screen.findByRole("button", {
      name: "포인트 템플릿으로 시작",
    });
    // 하단 포인트 — 끝 확대가 더해지고, 전체 샷 자리는 실사 사진이다.
    expect(
      within(point).getByRole("img", { name: "포인트, 아래 끝 확대" }),
    ).toBeTruthy();
    expect(
      within(point).getByRole("img", { name: "포인트" }).getAttribute("src"),
    ).toBe("/templates/b/full.jpg");

    // 칩은 "전체" + 데이터에 나온 분류만, 고르면 그 분류만 남는다.
    expect(screen.queryByRole("button", { name: "도트" })).toBeNull();
    screen.getByRole("button", { name: "스트라이프" }).click();
    await screen.findByRole("button", { name: "포인트 템플릿으로 시작" });
    expect(
      screen.queryByRole("button", { name: "올패턴 템플릿으로 시작" }),
    ).toBeNull();
  });

  it("비로그인으로 눌렀다 로그인하고 돌아오면 그 템플릿으로 이어서 시작한다", async () => {
    api.startFromExample.mockResolvedValue({ data: { id: "session-3" } });
    renderPage({ startTemplate: "example-9" });

    await screen.findByText("색 고르기");
    expect(api.startFromExample).toHaveBeenCalledTimes(1);
    expect(api.startFromExample).toHaveBeenCalledWith({
      body: { example_id: "example-9" },
      throwOnError: true,
    });
  });
});
