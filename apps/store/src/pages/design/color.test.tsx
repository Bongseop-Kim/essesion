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
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "@/shared/store/session";

const api = vi.hoisted(() => ({
  applyColorway: vi.fn(),
  placeLogo: vi.fn(),
  finalize: vi.fn(),
}));
const ui = vi.hoisted(() => ({ snackbar: vi.fn() }));
// useBreakpoint는 matchMedia 결과를 모듈에 캐시한다 — 폭은 이 값을 읽는 getter로 바꾼다.
const screenSize = { desktop: true };

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
      {
        id: "preset_1",
        name: "네이비 · 골드",
        mapping: { ground: "#1B2A49", color_1: "#C9A24B", fixed: "#888888" },
      },
    ],
  },
  current_motifs: [{ motif_id: "m-dots" }, { motif_id: "m-bee" }],
};
const JOB = {
  id: "job-1",
  kind: "finalize",
  status: "succeeded",
  session_id: "session-1",
  created_at: "2026-10-13T00:00:00Z",
  result_url: null,
  tie_url: "https://cdn/tie.png",
  fabric_url: "https://cdn/fabric.png",
};

vi.mock("@essesion/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/shared")>()),
  snackbar: ui.snackbar,
}));
vi.mock("@essesion/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/api-client")>()),
  applyColorway: api.applyColorway,
  placeDesignLogo: api.placeLogo,
  createFinalizeJob: api.finalize,
}));
vi.mock("@/shared/lib/live-queries", () => ({
  designExamplesQueryOptions: () => ({
    queryKey: ["examples"],
    queryFn: async () => [],
  }),
  tokenBalanceQueryOptions: () => ({
    queryKey: ["balance"],
    queryFn: async () => ({ total: 455, finalize_cost: 200 }),
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

function ResultStub() {
  const { state } = useLocation();
  return <p>결과 {(state as { job: { id: string } }).job.id}</p>;
}

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
          <Route path="/design/sessions/:id/result" element={<ResultStub />} />
          <Route
            path="/design/sessions/:id/color"
            element={<DesignColorPage />}
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function uploadLogo() {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  const file = new File(["<svg id='logo'/>"], "acme.svg", {
    type: "image/svg+xml",
  });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: /^생성/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
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
    URL.createObjectURL = vi.fn(() => "blob:logo");
    URL.revokeObjectURL = vi.fn();
    // jsdom의 File에는 arrayBuffer가 없다 — SVG 읽기 경로가 쓴다.
    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = function arrayBuffer() {
        return new Promise<ArrayBuffer>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.readAsArrayBuffer(this);
        });
      };
    }
    screenSize.desktop = true;
    // 모바일 색상 편집 시트(Modal)가 쓴다 — jsdom의 dialog에는 없다.
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
    // 모바일 배색·계열 줄의 ScrollFog가 쓴다 — jsdom에는 없다.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return (
          query.includes("prefers-reduced-motion") ||
          (screenSize.desktop && query.includes("min-width"))
        );
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    api.applyColorway.mockResolvedValue({ data: { run_id: "r2" } });
    api.placeLogo.mockResolvedValue({ data: { warnings: [] } });
    api.finalize.mockResolvedValue({ data: JOB });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("부위마다 색을 고르면 서버 호출 없이 화면에서 바로 바뀐다", async () => {
    renderPage();

    // 이름 붙은 슬롯만 부위로 나오고, 첫 부위가 펼쳐져 있다.
    const ground = await screen.findByRole("radiogroup", { name: "바탕 색" });
    expect(screen.getAllByRole("radiogroup", { name: /색$/ })).toHaveLength(1);
    screen.getByRole("button", { name: /가는 세 줄/ });

    const swatch = within(ground).getAllByRole("radio")[0] as HTMLElement;
    fireEvent.click(swatch);
    expect(swatch.ariaChecked).toBe("true");
    // 미리보기는 치환된 SVG(데이터 URI) — 서버 호출 없이 바로 바뀐다.
    expect(document.body.innerHTML).toContain(
      encodeURIComponent(swatch.getAttribute("aria-label") ?? ""),
    );
    expect(api.applyColorway).not.toHaveBeenCalled();
    // 로고가 없으면 생성할 수 없다.
    expect(
      (screen.getByRole("button", { name: /^생성/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    screen.getByRole("button", { name: "생성 · 200토큰" });
  });

  it("로고를 올리고 생성하면 바꾼 색 → 로고 → 실사화 순서로 돌려 결과로 간다", async () => {
    renderPage();
    // 색 코드로 견본에 없는 색도 고른다.
    fireEvent.change(
      await screen.findByRole("textbox", { name: "바탕 색 코드" }),
      { target: { value: "123abc" } },
    );
    await uploadLogo();
    fireEvent.click(screen.getByRole("button", { name: /^생성/ }));

    await screen.findByText("결과 job-1");
    expect(api.applyColorway).toHaveBeenCalledWith({
      path: { session_id: "session-1" },
      body: { colors: { ground: "#123ABC" } },
      throwOnError: true,
    });
    // 슬롯은 서버가 정한다 — 화면은 이름·SVG만 보낸다.
    expect(api.placeLogo).toHaveBeenCalledWith({
      path: { session_id: "session-1" },
      body: { name: "acme", svg: "<svg id='logo'/>" },
      throwOnError: true,
    });
    expect(api.finalize).toHaveBeenCalledWith({
      path: { session_id: "session-1" },
      body: { production_method: "print", weave: "twill-45", dpi: 300 },
      throwOnError: true,
    });
    const order = (fn: { mock: { invocationCallOrder: number[] } }) =>
      fn.mock.invocationCallOrder[0] ?? 0;
    expect(order(api.applyColorway)).toBeLessThan(order(api.placeLogo));
    expect(order(api.placeLogo)).toBeLessThan(order(api.finalize));
  });

  it("추천 배색을 누르면 이름 붙은 부위 색을 한 번에 바꾼다", async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "네이비 · 골드" }),
    );
    await uploadLogo();
    fireEvent.click(screen.getByRole("button", { name: /^생성/ }));
    await waitFor(() =>
      expect(api.applyColorway).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { colors: { ground: "#1B2A49", color_1: "#C9A24B" } },
        throwOnError: true,
      }),
    );
  });

  it("색을 바꾸지 않으면 색 적용 없이 로고와 실사화만 돌린다", async () => {
    renderPage();
    await screen.findByRole("radiogroup", { name: "바탕 색" });
    await uploadLogo();
    fireEvent.click(screen.getByRole("button", { name: /^생성/ }));
    await screen.findByText("결과 job-1");
    expect(api.applyColorway).not.toHaveBeenCalled();
    expect(api.placeLogo).toHaveBeenCalled();
  });

  it("모바일은 로고 올리기가 주 버튼이고, 통과하면 같은 자리에서 생성한다", async () => {
    screenSize.desktop = false;
    renderPage();

    // 로고 전에는 생성 버튼 대신 로고 올리기, 색 견본은 시트를 열어야 보인다.
    await screen.findByRole("button", { name: "로고 올리기" });
    expect(screen.queryByRole("button", { name: /^생성/ })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "바탕 색" })).toBeNull();

    // 추천 배색과 견본은 색상 편집 시트 안에 있다.
    fireEvent.click(screen.getByRole("button", { name: "색상 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "네이비 · 골드" }));
    const ground = screen.getByRole("radiogroup", { name: "바탕 색" });
    expect(
      screen.getByRole("textbox", { name: "바탕 색 코드" }),
    ).toHaveProperty("value", "#1B2A49");
    // 부위가 하나면 부위 칩 없이 그 부위 견본만.
    expect(within(ground).getAllByRole("radio").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    // 다시 열어 바꾼 색은 닫아도 그대로 남는다(확인·취소 없음).
    fireEvent.click(screen.getByRole("button", { name: "색상 편집" }));
    expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "바탕 색 코드" }), {
      target: { value: "123abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    await uploadLogo();
    fireEvent.click(screen.getByRole("button", { name: /^생성/ }));
    await screen.findByText("결과 job-1");
    expect(api.applyColorway).toHaveBeenCalledWith({
      path: { session_id: "session-1" },
      body: { colors: { ground: "#123ABC", color_1: "#C9A24B" } },
      throwOnError: true,
    });
  });
});
