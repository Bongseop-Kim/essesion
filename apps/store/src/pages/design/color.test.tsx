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

const api = vi.hoisted(() => ({ applyColorway: vi.fn() }));
const ui = vi.hoisted(() => ({ snackbar: vi.fn() }));

const SESSION = {
  id: "session-1",
  preview_svg: '<svg><rect fill="#103A40"/></svg>',
  colorway: "default",
  current_intent: {
    palette: { slots: [{ id: "ground", hex: "#103a40" }] },
    colorways: [
      { id: "default", name: "default", mapping: { ground: "#103a40" } },
      { id: "preset_1", name: "네이비 · 골드", mapping: { ground: "#1b2a49" } },
    ],
  },
};

vi.mock("@essesion/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/shared")>()),
  snackbar: ui.snackbar,
}));
vi.mock("@essesion/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/api-client")>()),
  applyColorway: api.applyColorway,
}));
vi.mock("@/shared/lib/live-queries", () => ({
  designExamplesQueryOptions: () => ({
    queryKey: ["examples"],
    queryFn: async () => [],
  }),
}));
vi.mock("@/features/design/model/queries", () => ({
  designSessionQueryKey: (id: string) => ["session", id],
  designSessionQueryOptions: ({ sessionId }: { sessionId: string }) => ({
    queryKey: ["session", sessionId],
    queryFn: async () => SESSION,
  }),
}));

import { DesignColorPage } from "./color";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  render(
    <MemoryRouter initialEntries={["/design/sessions/session-1/color"]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route
            path="/design/sessions/:id/logo"
            element={<p>로고 올리기</p>}
          />
          <Route
            path="/design/sessions/:id/color"
            element={<DesignColorPage />}
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("DesignColorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("프리셋을 고르면 화면에서 바로 색이 바뀌고, 다음에서만 서버에 적용한다", async () => {
    api.applyColorway.mockResolvedValue({ data: { run_id: "r2" } });
    renderPage();

    const navy = await screen.findByRole("radio", { name: "네이비 · 골드" });
    expect(screen.getByRole("radio", { name: "기본" }).ariaChecked).toBe(
      "true",
    );
    expect(api.applyColorway).not.toHaveBeenCalled();

    fireEvent.click(navy);
    expect(navy.ariaChecked).toBe("true");
    // 미리보기는 치환된 SVG(데이터 URI) — 서버 호출 없이 바로 바뀐다.
    expect(document.body.innerHTML).toContain(encodeURIComponent("#1b2a49"));
    expect(
      screen.getAllByRole("img", { name: /네이비 · 골드 색 미리보기/ }).length,
    ).toBeGreaterThan(0);
    expect(api.applyColorway).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "다음 · 로고 올리기" }));
    await waitFor(() =>
      expect(api.applyColorway).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { colorway_id: "preset_1" },
        throwOnError: true,
      }),
    );
    await screen.findByText("로고 올리기");
  });

  it("색을 바꾸지 않고 다음을 누르면 서버를 부르지 않는다", async () => {
    renderPage();
    await screen.findByRole("radio", { name: "기본" });
    fireEvent.click(screen.getByRole("button", { name: "다음 · 로고 올리기" }));
    await screen.findByText("로고 올리기");
    expect(api.applyColorway).not.toHaveBeenCalled();
  });
});
