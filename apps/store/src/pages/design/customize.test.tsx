// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "@/shared/store/session";

const api = vi.hoisted(() => ({
  placeLogo: vi.fn(),
  // jsdom에는 canvas가 없다 — PNG 변환은 받은 SVG만 기록한다.
  toPng: vi.fn(async (_svg: string, name: string) => new File(["png"], name)),
}));
const ui = vi.hoisted(() => ({ snackbar: vi.fn() }));
// useBreakpoint는 matchMedia 결과를 모듈에 캐시한다 — 폭은 이 값을 읽는 getter로 바꾼다.
const screenSize = { desktop: true };
// 세션이 시작한 템플릿 목록 — 로고 자리(logo_slots)를 여기서 읽는다.
const gallery: { list: unknown[] } = { list: [] };

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
  example_id: "tpl-1",
  current_motifs: [{ motif_id: "m-dots" }, { motif_id: "m-bee" }],
};
vi.mock("@essesion/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/shared")>()),
  snackbar: ui.snackbar,
}));
vi.mock("@essesion/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/api-client")>()),
  placeDesignLogo: api.placeLogo,
}));
vi.mock("@/features/design/model/svg-preview", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/design/model/svg-preview")
  >()),
  svgToPngFile: api.toPng,
}));
vi.mock("@/shared/lib/live-queries", () => ({
  designExamplesQueryOptions: () => ({
    queryKey: ["examples"],
    queryFn: async () => gallery.list,
  }),
}));
vi.mock("@/features/design/model/queries", () => ({
  designSessionQueryKey: (id: string) => ["session", id],
  designSessionQueryOptions: ({ sessionId }: { sessionId: string }) => ({
    queryKey: ["session", sessionId],
    queryFn: async () => SESSION,
  }),
}));

import { DesignCustomizePage } from "./customize";

function OrderStub() {
  const { state } = useLocation();
  const files = (state as { designFiles: File[] }).designFiles;
  return <p>주문 {files.map((file) => file.name).join(",")}</p>;
}

/** 주문으로 넘긴 디자인 PNG의 원본 SVG */
const orderedSvg = () => api.toPng.mock.calls[0]?.[0] ?? "";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  render(
    <MemoryRouter initialEntries={["/design/sessions/session-1/customize"]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/custom-order" element={<OrderStub />} />
          <Route
            path="/design/sessions/:id/customize"
            element={<DesignCustomizePage />}
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** 로고 자리 줄을 눌러 파일을 고른다 — 통과하면 바로 그 자리에 들어가 미리보기가 바뀐다. */
async function uploadLogo(row: RegExp = /^로고/, filename = "acme.svg") {
  // 모바일의 "로고 올리기" CTA와 구분하려고 자리 목록 안에서 찾는다.
  const list = await screen.findByRole("list");
  fireEvent.click(within(list).getByRole("button", { name: row }));
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  const file = new File(["<svg id='logo'/>"], filename, {
    type: "image/svg+xml",
  });
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText("통과 · 미리보기에 넣었어요");
}

describe("DesignCustomizePage", () => {
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
    gallery.list = [];
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
    api.placeLogo.mockResolvedValue({ data: { warnings: [] } });
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
    // 로고가 없으면 주문할 수 없다.
    expect(
      (
        screen.getByRole("button", {
          name: "바로 주문하기",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("로고는 올리면 바로 넣고, 바로 주문하기는 지금 디자인을 PNG로 주문에 넘긴다", async () => {
    renderPage();
    // 색 코드로 견본에 없는 색도 고른다.
    fireEvent.change(
      await screen.findByRole("textbox", { name: "바탕 색 코드" }),
      { target: { value: "123abc" } },
    );
    await uploadLogo();
    // 템플릿이 자리를 안 알려주면 slot 없이 보낸다 — 서버가 첫 자리를 고른다.
    expect(api.placeLogo).toHaveBeenCalledWith({
      path: { session_id: "session-1" },
      body: { name: "acme", svg: "<svg id='logo'/>" },
      throwOnError: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "바로 주문하기" }));

    await screen.findByText("주문 design.png");
    // 고른 색이 이미지에 들어간다 — 서버 색 적용 없이.
    expect(orderedSvg()).toContain("#123ABC");
  });

  it("템플릿 로고 자리마다 업로드 줄이 있고, 같은 자리에 다시 올리면 그 자리만 바뀐다", async () => {
    gallery.list = [
      {
        id: "tpl-1",
        point: "none",
        logo_slots: [
          { slot: 2, label: "로고" },
          { slot: 1, label: "작은 무늬" },
        ],
        logo_preview_svg: null,
      },
    ];
    renderPage();

    await uploadLogo(/^작은 무늬/);
    expect(api.placeLogo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ slot: 1 }),
      }),
    );
    // 다시 올리면 같은 자리를 덮는다 — 줄이 늘지 않는다.
    await uploadLogo(/^작은 무늬/, "acme2.svg");
    expect(api.placeLogo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ name: "acme2", slot: 1 }),
      }),
    );
    expect(screen.getAllByRole("button", { name: /^작은 무늬/ })).toHaveLength(
      1,
    );
    screen.getByRole("button", { name: "로고" });
  });

  it("추천 배색을 누르면 이름 붙은 부위 색을 한 번에 바꾼다", async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "네이비 · 골드" }),
    );
    await uploadLogo();
    fireEvent.click(screen.getByRole("button", { name: "바로 주문하기" }));
    await screen.findByText("주문 design.png");
    expect(orderedSvg()).toContain("#1B2A49");
    expect(orderedSvg()).toContain("#C9A24B");
  });

  it("모바일은 로고 올리기가 주 버튼이고, 통과하면 같은 자리에서 바로 주문한다", async () => {
    screenSize.desktop = false;
    renderPage();

    // 로고 전에는 주문 버튼 대신 로고 올리기, 색 견본은 시트를 열어야 보인다.
    await screen.findByRole("button", { name: "로고 올리기" });
    expect(screen.queryByRole("button", { name: "바로 주문하기" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "바로 주문하기" }));
    await screen.findByText("주문 design.png");
    expect(orderedSvg()).toContain("#123ABC");
    expect(orderedSvg()).toContain("#C9A24B");
  });
});
