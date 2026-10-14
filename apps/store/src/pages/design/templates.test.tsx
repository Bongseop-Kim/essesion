// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "@/shared/store/session";

let examples: Record<string, unknown>[] = [];

vi.mock("@essesion/api-client/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/api-client/query")>()),
  listDesignExamplesOptions: () => ({
    queryKey: ["page-templates-examples"],
    queryFn: async () => examples,
  }),
}));

import { DesignTemplatesPage } from "./templates";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <MemoryRouter initialEntries={["/design"]}>
      <QueryClientProvider client={queryClient}>
        <DesignTemplatesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("DesignTemplatesPage", () => {
  beforeEach(() => {
    examples = [];
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

  it("템플릿 행은 상세 페이지로 가는 링크다", async () => {
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
      },
    ];
    renderPage();

    const row = await screen.findByRole("link", {
      name: "미드나잇 웨이브 템플릿 자세히 보기",
    });
    expect(row.getAttribute("href")).toBe("/design/templates/example-1");
    expect(within(row).getByText("네이비 · 대각 스트라이프")).toBeTruthy();
    // 올패턴 — 전체 샷 + 무늬 확대만. 포인트 확대(매듭·끝)는 포인트가 있을 때만.
    expect(
      within(row).getByRole("img", { name: "미드나잇 웨이브, 무늬 확대" }),
    ).toBeTruthy();
    expect(
      within(row).queryByRole("img", { name: "미드나잇 웨이브, 매듭 확대" }),
    ).toBeNull();
  });

  it("분류 칩은 템플릿 데이터의 category이고, 포인트·사진은 그 값대로 그린다", async () => {
    const base = {
      caption: null,
      preview_svg: "<svg id='e1'/>",
      logo_slot: 1,
      photo_full_url: null,
      photo_detail_url: null,
      logo_preview_svg: null,
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

    const point = await screen.findByRole("link", {
      name: "포인트 템플릿 자세히 보기",
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
    await screen.findByRole("link", { name: "포인트 템플릿 자세히 보기" });
    expect(
      screen.queryByRole("link", { name: "올패턴 템플릿 자세히 보기" }),
    ).toBeNull();
  });
});
