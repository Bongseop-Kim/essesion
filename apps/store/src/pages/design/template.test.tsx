// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "@/shared/store/session";

const api = vi.hoisted(() => ({ startFromExample: vi.fn() }));
const ui = vi.hoisted(() => ({ snackbar: vi.fn() }));
let examples: Record<string, unknown>[] = [];
let examplesFail = false;

vi.mock("@essesion/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/shared")>()),
  snackbar: ui.snackbar,
}));
vi.mock("@essesion/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/api-client")>()),
  createDesignSessionFromExample: api.startFromExample,
}));
vi.mock("@essesion/api-client/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/api-client/query")>()),
  listDesignExamplesOptions: () => ({
    queryKey: ["page-template-examples"],
    queryFn: async () => {
      if (examplesFail) throw new Error("down");
      return examples;
    },
  }),
}));
vi.mock("@/features/auth/ui/auth-guard-provider", () => ({
  useAuthGuard: () => ({ requireAuth: () => true }),
}));

import { DesignTemplatePage } from "./template";

function renderPage(path = "/design/templates/example-1") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/design" element={<p>캔버스</p>} />
          <Route path="/design/sessions/:id/color" element={<p>색 고르기</p>} />
          <Route
            path="/design/templates/:id"
            element={<DesignTemplatePage />}
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("DesignTemplatePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    examplesFail = false;
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
    useSession.setState({
      status: "authenticated",
      accessToken: "access-token",
      user: null,
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("목록 캐시에서 템플릿을 찾아 큰 샷과 설명을 보여주고, 시작하면 세션을 만들고 색 선택으로 간다", async () => {
    api.startFromExample.mockResolvedValue({ data: { id: "session-2" } });
    renderPage();

    await screen.findByRole("heading", { name: "미드나잇 웨이브" });
    expect(screen.getByText("네이비 · 대각 스트라이프")).toBeTruthy();
    // 올패턴 — 전체 샷 + 무늬 확대만. 매듭·끝 확대는 포인트가 있을 때만.
    expect(
      screen.getByRole("img", { name: "미드나잇 웨이브, 무늬 확대" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: "미드나잇 웨이브, 아래 끝 확대" }),
    ).toBeNull();
    // 보기만 하면 서버 호출이 없다.
    expect(api.startFromExample).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "이 템플릿으로 시작" }));
    await waitFor(() =>
      expect(api.startFromExample).toHaveBeenCalledWith({
        body: { example_id: "example-1" },
        throwOnError: true,
      }),
    );
    await screen.findByText("색 고르기");
    // 화면 전환이 곧 결과다 — 성공 알림을 따로 띄우지 않는다.
    expect(ui.snackbar).not.toHaveBeenCalled();
  });

  it("없는 템플릿은 목록으로 돌아가는 빈 상태를 보여준다", async () => {
    renderPage("/design/templates/missing");
    await screen.findByText("템플릿을 찾을 수 없어요");
    fireEvent.click(screen.getByRole("button", { name: "템플릿 목록으로" }));
    await screen.findByText("캔버스");
  });

  it("목록 조회가 실패하면 다시 시도할 수 있다", async () => {
    examplesFail = true;
    renderPage();
    await screen.findByText("템플릿을 불러오지 못했어요");
    examplesFail = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByRole("heading", { name: "미드나잇 웨이브" });
  });
});
