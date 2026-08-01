// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DESIGN_ONBOARDING_KEY } from "@/features/design/model/onboarding";
import { useSession } from "@/shared/store/session";

// 세션→턴 쿼리 체인 뒤에 나타나는 요소는 CI 2코어 러너에서 렌더 사이클당
// ~1초가 걸리고, 파일 첫 테스트는 콜드 스타트(첫 렌더 + 워커 경합)로 3초도
// 초과한 전례가 있다. 이 파일만 대기·테스트 한도를 올린다.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });

const RUN_1 = "11111111-1111-4111-8111-111111111111";
const RUN_2 = "22222222-2222-4222-8222-222222222222";

const api = vi.hoisted(() => ({
  createSession: vi.fn(),
  generate: vi.fn(),
  activateStep: vi.fn(),
  searchMotifs: vi.fn(),
  generateMotif: vi.fn(),
  activateMotif: vi.fn(),
}));

vi.mock("@essesion/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@essesion/api-client")>();
  return {
    ...actual,
    createDesignSession: api.createSession,
    generateDesign: api.generate,
    activateDesignStep: api.activateStep,
    searchMotifs: api.searchMotifs,
    generateMotif: api.generateMotif,
    activateMotif: api.activateMotif,
  };
});

vi.mock("@/features/auth", () => ({
  useAuthGuard: () => ({ requireAuth: () => true }),
}));

const session = {
  id: "session-1",
  status: "active",
  seed: 1,
  colorway: "default",
  registry_version: null,
  current_intent: { motif: "bee" },
  current_plan: null,
  current_motifs: [
    { motif_id: "catalog-bee", name: "벌", preview_svg: "<svg id='bee'/>" },
  ],
  recraft_used: 1,
  recraft_remaining: 2,
  context_version: 4,
  active_generation_id: null,
  active_generation_started_at: null,
  created_at: "2026-07-31T00:00:00Z",
  updated_at: "2026-07-31T00:00:00Z",
  finalize_quota: null,
};

/** 세션 응답을 케이스별로 덮어쓴다(예: 생성 예산 소진). beforeEach가 비운다. */
let sessionOverride: Record<string, unknown> = {};

const step = (seq: number, runId: string, svg: string) => ({
  id: `turn-${seq}`,
  seq,
  role: "assistant",
  created_at: "2026-07-31T00:00:00Z",
  attachments: [],
  payload: {
    type: "generate",
    run_id: runId,
    status: "succeeded",
    summary: "요약",
    response: {
      run_id: runId,
      design: { id: `d-${seq}`, seed: 1, colorway_id: "default", svg },
    },
  },
});

const activated = (seq: number, runId: string) => ({
  id: `turn-${seq}`,
  seq,
  role: "user",
  created_at: "2026-07-31T00:00:00Z",
  attachments: [],
  payload: { type: "activate", run_id: runId, seed: 1, colorway_id: "default" },
});

const turns = [
  step(1, RUN_1, "<svg id='a'/>"),
  activated(2, RUN_1),
  step(3, RUN_2, "<svg id='b'/>"),
  activated(4, RUN_2),
];

vi.mock("@/features/design/model/queries", () => ({
  designSessionsQueryOptions: (authenticated: boolean) => ({
    queryKey: ["page-design-sessions"],
    queryFn: async () => [{ id: "session-1" }],
    enabled: authenticated,
  }),
  designSessionQueryKey: (sessionId: string) => [
    "page-design-session",
    sessionId,
  ],
  designSessionQueryOptions: ({ sessionId }: { sessionId: string | null }) => ({
    queryKey: ["page-design-session", sessionId],
    queryFn: async () => ({ ...session, ...sessionOverride }),
    enabled: !!sessionId,
  }),
  designTurnsQueryKey: (sessionId: string) => ["page-design-turns", sessionId],
  designTurnsQueryOptions: ({ sessionId }: { sessionId: string | null }) => ({
    queryKey: ["page-design-turns", sessionId],
    queryFn: async () => turns,
    enabled: !!sessionId,
  }),
  generationJobQueryKey: (jobId: string) => ["page-generation-job", jobId],
  generationJobQueryOptions: ({ jobId }: { jobId: string | null }) => ({
    queryKey: ["page-generation-job", jobId],
    queryFn: async () => null,
    enabled: !!jobId,
  }),
  finalizedJobsInfiniteQueryOptions: (authenticated: boolean) => ({
    queryKey: ["page-finalized-jobs"],
    queryFn: async () => [],
    enabled: authenticated,
    initialPageParam: 0,
    getNextPageParam: () => undefined,
  }),
  designTokenBalanceQueryOptions: () => ({
    queryKey: ["page-design-balance"],
    queryFn: async () => ({ total: 455, generate_cost: 5, edit_cost: 2 }),
  }),
}));

import { DesignPage } from "./index";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function disabled(element: HTMLElement) {
  return (element as HTMLButtonElement | HTMLInputElement).disabled;
}

/** 지금 열려 있는 오버레이의 제목들 — dialog 자식은 닫혀도 DOM에 남는다. */
function openDialogs() {
  return Array.from(
    document.querySelectorAll("dialog[open]"),
    (dialog) => dialog.querySelector("h2")?.textContent,
  );
}

/** 오버레이가 실제로 열릴 때까지 기다린다(자식 조회는 닫힌 모달도 찾으므로). */
async function waitForDialog(title: string) {
  await waitFor(() => expect(openDialogs()).toEqual([title]));
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  render(
    <MemoryRouter initialEntries={["/design"]}>
      <QueryClientProvider client={queryClient}>
        <DesignPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return queryClient;
}

describe("DesignPage canvas shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionOverride = {};
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    localStorage.setItem(DESIGN_ONBOARDING_KEY, "1");
    useSession.setState({
      status: "authenticated",
      accessToken: "access-token",
      user: null,
    });
    api.createSession.mockResolvedValue({ data: { id: "session-1" } });
    api.activateMotif.mockResolvedValue({ data: { warnings: [] } });
    // min-width는 전부 false(모바일 390 렌더), 모션 축소만 true — 오버레이 교대가 즉시 끝난다.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
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
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    URL.createObjectURL = vi.fn(() => "blob:reference");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useSession.setState({ status: "anonymous", accessToken: null, user: null });
  });

  it("이력 썸네일 클릭이 그 스텝을 activate 한다 — 되돌리기 버튼은 없다", async () => {
    api.activateStep.mockResolvedValue({ data: session });
    const queryClient = renderPage();

    const first = await screen.findByRole("button", {
      name: "1번째 디자인으로 되돌리기",
    });
    // 포인터가 가리키는 마지막 스텝은 포커스는 되지만 눌러도 아무 일도 없다.
    const current = screen.getByRole("button", {
      name: "2번째 디자인, 현재 편집 중",
    });
    expect(disabled(current)).toBe(false);
    fireEvent.click(current);
    expect(api.activateStep).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /되돌리기$/ })).toBe(first);

    fireEvent.click(first);
    await waitFor(() =>
      expect(api.activateStep).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { run_id: RUN_1 },
        throwOnError: true,
      }),
    );
    queryClient.clear();
  });

  it("범위 밖 거절은 문장을 남기고 전체 선택하며 빨강 알림만 띄운다", async () => {
    api.generate.mockResolvedValue({ data: { rejected: "motif" } });
    const select = vi.spyOn(HTMLInputElement.prototype, "select");
    const queryClient = renderPage();

    const input = await screen.findByLabelText("무엇을 바꿀까요?");
    fireEvent.change(input, { target: { value: "벌을 나비로 바꿔줘" } });
    fireEvent.click(screen.getByRole("button", { name: "디자인에 적용" }));

    await screen.findByText(/그림을 바꾸는 건 왼쪽 .*모티프/);
    expect((input as HTMLInputElement).value).toBe("벌을 나비로 바꿔줘");
    expect(select).toHaveBeenCalled();
    // 거절은 이력에 스텝을 남기지 않는다.
    expect(
      screen.queryByRole("button", { name: "3번째 디자인으로 되돌리기" }),
    ).toBeNull();
    select.mockRestore();
    queryClient.clear();
  });

  it("적용 중에는 입력창을 잠그고 이력 끝에 대기 칸을 만든다", async () => {
    let finish!: (value: unknown) => void;
    api.generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const queryClient = renderPage();

    const input = await screen.findByLabelText("무엇을 바꿀까요?");
    fireEvent.change(input, { target: { value: "줄무늬를 넓게" } });
    fireEvent.click(screen.getByRole("button", { name: "디자인에 적용" }));

    await waitFor(() => expect(disabled(input)).toBe(true));
    screen.getByText("적용 중");
    expect(disabled(screen.getByRole("button", { name: "내려받기" }))).toBe(
      true,
    );

    await act(async () => {
      finish({ data: { rejected: "motif" } });
    });
    await waitFor(() => expect(disabled(input)).toBe(false));
    queryClient.clear();
  });

  it("첫 진입은 안내와 비활성 액션을 보여준다", async () => {
    useSession.setState({ status: "anonymous", accessToken: null, user: null });
    const queryClient = renderPage();

    await screen.findByText("아직 만든 디자인이 없어요");
    expect(disabled(screen.getByRole("button", { name: "내려받기" }))).toBe(
      true,
    );
    expect(disabled(screen.getByRole("button", { name: "실사화" }))).toBe(true);
    expect(disabled(screen.getByRole("button", { name: "참고 사진" }))).toBe(
      false,
    );
    queryClient.clear();
  });

  it("엔터로 검색하고 고른 그림으로 바꿔도 잔액이 그대로다", async () => {
    api.searchMotifs.mockResolvedValue({
      data: {
        results: [
          {
            motif_id: "catalog-bee",
            name: "벌",
            preview_svg: "<svg/>",
            current: true,
          },
          {
            motif_id: "catalog-wing",
            name: "날개 편 벌",
            preview_svg: "<svg/>",
          },
        ],
      },
    });
    const queryClient = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "벌 바꾸기" }));
    await waitForDialog("모티프 바꾸기");
    const input = screen.getByLabelText("어떤 그림을 넣을지");
    fireEvent.change(input, { target: { value: "작은 벌" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(api.searchMotifs).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { query: "작은 벌" },
        throwOnError: true,
      }),
    );
    // 지금 쓰는 그림은 한 칸 차지하되 확정 대상이 될 수 없다.
    fireEvent.click(
      await screen.findByRole("button", { name: "지금 쓰는 그림 고르기" }),
    );
    expect(
      disabled(screen.getByRole("button", { name: "이 그림으로 바꾸기" })),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "날개 편 벌 고르기" }));
    fireEvent.click(screen.getByRole("button", { name: "이 그림으로 바꾸기" }));

    await waitFor(() =>
      expect(api.activateMotif).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { slot: 1, motif_id: "catalog-wing" },
        throwOnError: true,
      }),
    );
    // 무료 경로 — 모델을 부르지 않고 잔액 표시도 그대로다.
    expect(api.generateMotif).not.toHaveBeenCalled();
    screen.getByText("455토큰");
    queryClient.clear();
  });

  it("검색 결과가 0건이면 안내만 남는다", async () => {
    api.searchMotifs.mockResolvedValue({ data: { results: [] } });
    const queryClient = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "벌 바꾸기" }));
    await waitForDialog("모티프 바꾸기");
    const input = screen.getByLabelText("어떤 그림을 넣을지");
    fireEvent.change(input, { target: { value: "없는 그림" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await screen.findByText("찾은 그림이 없어요");
    expect(
      disabled(screen.getByRole("button", { name: "이 그림으로 바꾸기" })),
    ).toBe(true);
    queryClient.clear();
  });

  it("생성은 확인 모달을 지나서만 호출되고 성공하면 바로 슬롯에 들어간다", async () => {
    api.generateMotif.mockResolvedValue({
      data: {
        request_id: "req-1",
        reused: false,
        motif: {
          motif_id: "recraft-bee",
          name: "작은 벌",
          preview_svg: "<svg/>",
        },
      },
    });
    const queryClient = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "벌 바꾸기" }));
    await waitForDialog("모티프 바꾸기");
    fireEvent.change(screen.getByLabelText("어떤 그림을 넣을지"), {
      target: { value: "작은 벌" },
    });
    await screen.findByText("문장 그대로 새로 만들어요 · 2번 더 가능");

    fireEvent.click(screen.getByRole("button", { name: "새로 만들기" }));
    // 유료 행은 확인 모달을 여는 것까지만 한다.
    expect(api.generateMotif).not.toHaveBeenCalled();
    // 모달 위 모달 금지 — 모티프 모달이 닫힌 뒤에 확인 모달이 열린다.
    await waitForDialog("모티프 새로 만들기");
    const prompt = screen.getByLabelText("새로 만들 그림");
    expect((prompt as HTMLInputElement).value).toBe("작은 벌");

    fireEvent.change(prompt, { target: { value: "아주 작은 벌" } });
    fireEvent.click(screen.getByRole("button", { name: "이 문장으로 만들기" }));

    await waitFor(() =>
      expect(api.generateMotif).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { prompt: "아주 작은 벌" },
        throwOnError: true,
      }),
    );
    await waitFor(() =>
      expect(api.activateMotif).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { slot: 1, motif_id: "recraft-bee" },
        throwOnError: true,
      }),
    );
    queryClient.clear();
  });

  it("생성 예산이 없으면 유료 행이 잠긴다", async () => {
    sessionOverride = { recraft_remaining: 0, recraft_used: 3 };
    const queryClient = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "벌 바꾸기" }));
    await waitForDialog("모티프 바꾸기");
    fireEvent.change(screen.getByLabelText("어떤 그림을 넣을지"), {
      target: { value: "작은 벌" },
    });

    await screen.findByText("이번 디자인에서 더 만들 수 없어요");
    expect(disabled(screen.getByRole("button", { name: "새로 만들기" }))).toBe(
      true,
    );
    queryClient.clear();
  });

  // matchMedia가 min-width에 false라 이 스위트는 base 브레이크포인트(모바일 390) 렌더다.
  it("모바일에서는 레일이 아이콘 1열이 되고 라벨과 모티프 메타가 사라진다", async () => {
    const queryClient = renderPage();

    const rail = await screen.findByRole("navigation", { name: "디자인 도구" });
    expect(rail.style.flexDirection).toBe("column");
    expect(screen.getByText("내려받기").style.display).toBe("none");
    // 접기 토글·슬롯 메타는 모바일에서 숨어 접근성 트리에서도 빠진다(썸네일만 남는다).
    expect(
      screen.queryByRole("button", { name: "모티프 카드 접기" }),
    ).toBeNull();
    queryClient.clear();
  });
});
