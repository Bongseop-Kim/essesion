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

const api = vi.hoisted(() => ({ applyColorway: vi.fn() }));
const ui = vi.hoisted(() => ({ snackbar: vi.fn() }));

const SESSION = {
  id: "session-1",
  preview_svg:
    '<svg><rect fill="#103A40"/><path fill="#CFCBC3"/><circle fill="#888888"/></svg>',
  colorway: "default",
  current_intent: {
    palette: {
      slots: [
        { id: "ground", hex: "#103a40", name: "바탕" },
        { id: "color_1", hex: "#cfcbc3", name: "가는 세 줄" },
        { id: "fixed", hex: "#888888" },
      ],
    },
    colorways: [
      {
        id: "default",
        name: "default",
        mapping: { ground: "#103a40", color_1: "#cfcbc3", fixed: "#888888" },
      },
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

  it("부위마다 실 색을 고르면 화면에서 바로 바뀌고, 다음에서 바꾼 부위만 서버에 보낸다", async () => {
    api.applyColorway.mockResolvedValue({ data: { run_id: "r2" } });
    renderPage();

    // 이름 붙은 슬롯만 부위로 나온다.
    const ground = await screen.findByRole("radiogroup", {
      name: "바탕 실 색",
    });
    screen.getByRole("radiogroup", { name: "가는 세 줄 실 색" });
    expect(screen.getAllByRole("radiogroup")).toHaveLength(2);

    const navy = within(ground).getByRole("radio", { name: "네이비" });
    fireEvent.click(navy);
    expect(navy.ariaChecked).toBe("true");
    // 미리보기는 치환된 SVG(데이터 URI) — 서버 호출 없이 바로 바뀐다.
    expect(document.body.innerHTML).toContain(encodeURIComponent("#1B2A49"));
    expect(api.applyColorway).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "다음 · 로고 올리기" }));
    await waitFor(() =>
      expect(api.applyColorway).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { colors: { ground: "#1B2A49" } },
        throwOnError: true,
      }),
    );
    await screen.findByText("로고 올리기");
  });

  it("색을 바꾸지 않고 다음을 누르면 서버를 부르지 않는다", async () => {
    renderPage();
    await screen.findByRole("radiogroup", { name: "바탕 실 색" });
    fireEvent.click(screen.getByRole("button", { name: "다음 · 로고 올리기" }));
    await screen.findByText("로고 올리기");
    expect(api.applyColorway).not.toHaveBeenCalled();
  });
});
