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
  within,
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
  importMotif: vi.fn(),
  startFromExample: vi.fn(),
  deleteSession: vi.fn(),
  previewTextMotif: vi.fn(),
}));
const ui = vi.hoisted(() => ({ snackbar: vi.fn() }));

vi.mock("@essesion/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/shared")>()),
  snackbar: ui.snackbar,
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
    importUserMotif: api.importMotif,
    createDesignSessionFromExample: api.startFromExample,
    deleteDesignSession: api.deleteSession,
    previewTextMotif: api.previewTextMotif,
  };
});

vi.mock("@/features/auth/ui/auth-guard-provider", () => ({
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
  context_version: 4,
  active_generation_id: null,
  active_generation_started_at: null,
  created_at: "2026-07-31T00:00:00Z",
  updated_at: "2026-07-31T00:00:00Z",
};

/** 세션 응답을 케이스별로 덮어쓴다(예: 생성 예산 소진). beforeEach가 비운다. */
let sessionOverride: Record<string, unknown> = {};
/** 세션 목록 응답을 늦출 게이트 — 예시가 먼저 도착하는 상황을 재현한다. */
let sessionsGate: Promise<unknown> = Promise.resolve();
/** 첫 진입 예시 갤러리 응답 — 기본은 0건(기존 빈 상태 폴백). */
let examples: Record<string, unknown>[] = [];
let tokenBalance = 455;

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
    queryFn: async () => {
      await sessionsGate;
      return [
        {
          id: "session-1",
          created_at: "2026-07-31T00:00:00Z",
          status: "active",
        },
      ];
    },
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
}));

// 잔액·예시는 shared/lib/live-queries의 래퍼를 그대로 쓴다 — 래퍼가 감싸는 raw 옵션만 바꾼다.
vi.mock("@essesion/api-client/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/api-client/query")>()),
  getTokenBalanceOptions: () => ({
    queryKey: ["page-design-balance"],
    queryFn: async () => ({
      total: tokenBalance,
      generate_cost: 3,
      edit_cost: 1,
      motif_generate_cost: 3,
    }),
  }),
  listDesignExamplesOptions: () => ({
    queryKey: ["page-design-examples"],
    queryFn: async () => examples,
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

async function openMobileTools() {
  fireEvent.click(screen.getByRole("button", { name: "디자인 도구 열기" }));
  await waitForDialog("디자인 도구");
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
    sessionsGate = Promise.resolve();
    examples = [];
    tokenBalance = 455;
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

  it("이력 카드의 ◀ 가 이전 디자인을 activate 하고 끝에서는 ▶ 가 잠긴다", async () => {
    api.activateStep.mockResolvedValue({ data: session });
    const queryClient = renderPage();

    const back = await screen.findByRole("button", {
      name: "1번째 디자인으로 되돌리기",
    });
    // 포인터가 마지막 스텝이라 앞으로 갈 곳이 없다.
    expect(disabled(screen.getByRole("button", { name: "다음 디자인" }))).toBe(
      true,
    );

    fireEvent.click(back);
    await waitFor(() =>
      expect(api.activateStep).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { run_id: RUN_1 },
        throwOnError: true,
      }),
    );
    queryClient.clear();
  });

  it("모티프 시그널은 문장을 남기고 피커를 강조하며 검색어를 채운다", async () => {
    api.generate.mockResolvedValue({
      data: {
        rejected: "motif",
        motif_intent: {
          detected: true,
          subject: "나비",
          reason: "motif_change",
        },
      },
    });
    const select = vi.spyOn(HTMLInputElement.prototype, "select");
    const queryClient = renderPage();

    const input = await screen.findByLabelText("무엇을 바꿀까요?");
    fireEvent.change(input, { target: { value: "벌을 나비로 바꿔줘" } });
    fireEvent.click(screen.getByRole("button", { name: "디자인에 적용" }));

    const panel = await screen.findByRole("region", { name: "모티프 선택" });
    await waitFor(() => expect(panel.dataset.highlighted).toBe("true"));
    expect((input as HTMLInputElement).value).toBe("벌을 나비로 바꿔줘");
    expect(select).toHaveBeenCalled();
    expect(screen.queryByText(/그림을 바꾸는 건 왼쪽 .*모티프/)).toBeNull();

    pickSource(screen.getByRole("button", { name: "벌 바꾸기" }), 1, /^탐색/);
    await waitForDialog("탐색");
    expect(
      (screen.getByLabelText("어떤 그림을 넣을지") as HTMLInputElement).value,
    ).toBe("나비");
    // 거절은 이력에 스텝을 남기지 않는다.
    expect(
      screen.queryByRole("button", { name: "3번째 디자인으로 되돌리기" }),
    ).toBeNull();
    select.mockRestore();
    queryClient.clear();
  });

  it("모바일에서 모티프 박스는 우측 하단으로 띄운다", async () => {
    const queryClient = renderPage();

    const panel = await screen.findByRole("region", { name: "모티프 선택" });
    // 컨트롤 레이어(absolute inset)를 기준으로 우측 하단 — PC(md~)는 static으로 되돌아간다.
    const wrapper = panel.parentElement as HTMLElement;
    expect(wrapper.style.position).toBe("absolute");
    expect(wrapper.style.bottom).toBe("0px");
    expect(wrapper.style.right).toBe("0px");
    queryClient.clear();
  });

  it("안내할 시그널이 없는 거절은 상단 알림으로 알린다", async () => {
    api.generate.mockResolvedValue({ data: { rejected: "motif" } });
    const queryClient = renderPage();

    const input = await screen.findByLabelText("무엇을 바꿀까요?");
    fireEvent.change(input, { target: { value: "이걸 예쁘게 해줘" } });
    fireEvent.click(screen.getByRole("button", { name: "디자인에 적용" }));

    await screen.findByText(/그림을 바꾸는 건 왼쪽 .*모티프/);
    queryClient.clear();
  });

  it("적용 중에는 입력창과 이력 카드를 함께 잠근다", async () => {
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
    // 되돌리기는 적용이 끝날 때까지 잠긴다(썸네일 자리는 스켈레톤).
    expect(
      disabled(
        screen.getByRole("button", { name: "1번째 디자인으로 되돌리기" }),
      ),
    ).toBe(true);
    await openMobileTools();
    expect(disabled(screen.getByRole("button", { name: "내려받기" }))).toBe(
      true,
    );

    await act(async () => {
      finish({ data: { rejected: "motif" } });
    });
    await waitFor(() => expect(disabled(input)).toBe(false));
    queryClient.clear();
  });

  it("온보딩을 닫기로 끝내도 다시 뜨지 않는다", async () => {
    localStorage.removeItem(DESIGN_ONBOARDING_KEY);
    const queryClient = renderPage();

    await waitForDialog("AI 디자인 시작하기");
    // 마지막 `디자인 시작하기`가 아니라 우상단 X로 나가도 "봤음"이어야 한다.
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    await waitFor(() => expect(openDialogs()).toEqual([]));
    expect(localStorage.getItem(DESIGN_ONBOARDING_KEY)).toBe("1");
    queryClient.clear();
  });

  it("현재 세션을 지우면 다른 세션을 자동으로 열지 않는다", async () => {
    api.deleteSession.mockResolvedValue({ data: null });
    const queryClient = renderPage();

    await screen.findByLabelText("무엇을 바꿀까요?");
    await openMobileTools();
    fireEvent.click(screen.getByRole("button", { name: "내 디자인" }));
    await waitForDialog("내 디자인");
    fireEvent.click(screen.getByRole("button", { name: /세션 삭제$/ }));

    await waitForDialog("이 디자인을 삭제할까요?");
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(api.deleteSession).toHaveBeenCalled());
    // 목록에 그 세션이 아직 남아 보여도 캔버스는 빈 상태로 남는다.
    await screen.findByText("아직 만든 디자인이 없어요");
    queryClient.clear();
  });

  it("첫 진입은 안내와 비활성 액션을 보여준다", async () => {
    useSession.setState({ status: "anonymous", accessToken: null, user: null });
    const queryClient = renderPage();

    // 예시 0건이면 갤러리 대신 기존 빈 상태 문구로 폴백한다.
    await screen.findByText("아직 만든 디자인이 없어요");
    const motifSlot = screen.getByRole("button", {
      name: "모티프 슬롯 1에 그림 추가",
    });
    // 시작 전에는 슬롯이 잠기고, 이유는 패널에 상주한다.
    expect(disabled(motifSlot)).toBe(true);
    fireEvent.click(motifSlot);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      screen.getByText("예시를 고르거나 채팅으로 먼저 시작해 주세요."),
    ).toBeTruthy();

    await openMobileTools();
    expect(disabled(screen.getByRole("button", { name: "내려받기" }))).toBe(
      true,
    );
    expect(disabled(screen.getByRole("button", { name: "실사화" }))).toBe(true);
    expect(screen.queryByText("로그인 후 이용")).toBeNull();
    expect(disabled(screen.getByRole("button", { name: "내 디자인" }))).toBe(
      false,
    );
    expect(disabled(screen.getByRole("button", { name: "완성본" }))).toBe(
      false,
    );
    expect(screen.queryByRole("button", { name: "참고 사진" })).toBeNull();
    queryClient.clear();
  });

  it("비로그인 첫 진입에서 예시를 고르면 그 디자인으로 시작한다", async () => {
    useSession.setState({ status: "anonymous", accessToken: null, user: null });
    examples = [
      {
        id: "example-1",
        name: "미드나잇 웨이브",
        caption: "네이비 · 대각 스트라이프",
        preview_svg: "<svg id='e1'/>",
      },
    ];
    api.startFromExample.mockResolvedValue({
      data: { ...session, id: "session-2" },
    });
    const queryClient = renderPage();

    const card = await screen.findByRole("button", {
      name: "미드나잇 웨이브 예시로 시작하기",
    });
    // 타일 아래 흰 면이 제목·설명 두 줄을 받는다.
    expect(card.textContent).toBe("미드나잇 웨이브네이비 · 대각 스트라이프");

    fireEvent.click(card);

    await waitFor(() =>
      expect(api.startFromExample).toHaveBeenCalledWith({
        body: { example_id: "example-1" },
        throwOnError: true,
      }),
    );
    // 빈 세션을 새로 만들지도, 생성을 돌리지도 않는다 — 토큰이 들지 않는 경로다.
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.generate).not.toHaveBeenCalled();
    // 캔버스·이력이 그대로 채워진다(서버가 붙인 스텝 2개).
    await screen.findByRole("button", {
      name: "2번째 디자인 · 전체 이력 보기",
    });
    queryClient.clear();
  });

  it("작업 중이던 세션이 있으면 예시 갤러리를 먼저 띄우지 않는다", async () => {
    examples = [
      {
        id: "example-1",
        name: "미드나잇 웨이브",
        caption: "네이비 · 대각 스트라이프",
        preview_svg: "<svg id='e1'/>",
      },
    ];
    // 예시는 먼저, 세션 목록은 나중에 도착한다 — 깜빡임이 나던 순서.
    let openGate = () => {};
    sessionsGate = new Promise((resolve) => {
      openGate = () => resolve(null);
    });
    const queryClient = renderPage();
    const gallery = () =>
      screen.queryByRole("button", {
        name: "미드나잇 웨이브 예시로 시작하기",
      });

    await waitFor(() =>
      expect(queryClient.getQueryData(["page-design-examples"])).toBeTruthy(),
    );
    expect(gallery()).toBeNull();

    await act(async () => {
      openGate();
    });
    await screen.findByRole("button", {
      name: "2번째 디자인 · 전체 이력 보기",
    });
    expect(gallery()).toBeNull();
    queryClient.clear();
  });

  /** 슬롯 트리거를 눌러 소스 메뉴를 열고 항목 하나를 고른다. */
  function pickSource(slotTrigger: HTMLElement, slot: 1 | 2, item: RegExp) {
    fireEvent.click(slotTrigger);
    const menu = screen.getByRole("menu", {
      name: `슬롯 ${slot}에 그림 넣는 방법`,
    });
    fireEvent.click(within(menu).getByRole("menuitem", { name: item }));
  }

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

    pickSource(
      await screen.findByRole("button", { name: "벌 바꾸기" }),
      1,
      /^탐색/,
    );
    await waitForDialog("탐색");
    const input = screen.getByLabelText("어떤 그림을 넣을지");
    fireEvent.change(input, { target: { value: "작은 벌" } });

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

  it("탐색을 열면 첫 카테고리를 채우고, 칩을 누르면 그 라벨로 다시 찾는다", async () => {
    api.searchMotifs.mockResolvedValue({ data: { results: [] } });
    const queryClient = renderPage();

    pickSource(
      await screen.findByRole("button", { name: "벌 바꾸기" }),
      1,
      /^탐색/,
    );
    await waitForDialog("탐색");
    // 빈 그리드로 열지 않는다 — 첫 카테고리를 바로 훑어준다.
    await waitFor(() =>
      expect(api.searchMotifs).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { query: "동물" },
        throwOnError: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "바다" }));
    await waitFor(() =>
      expect(api.searchMotifs).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { query: "바다" },
        throwOnError: true,
      }),
    );
    // 칩 라벨이 그대로 검색어라 입력창에 들어간다 — 칩 선택 표시도 여기서 파생된다.
    expect(
      (screen.getByLabelText("어떤 그림을 넣을지") as HTMLInputElement).value,
    ).toBe("바다");
    screen.getByRole("button", { name: "바다", pressed: true });
    queryClient.clear();
  });

  it("타이핑 중에는 찾지 않고, 멎은 뒤 마지막 문장만 한 번 찾는다", async () => {
    api.searchMotifs.mockResolvedValue({ data: { results: [] } });
    const queryClient = renderPage();

    pickSource(
      await screen.findByRole("button", { name: "벌 바꾸기" }),
      1,
      /^탐색/,
    );
    await waitForDialog("탐색");
    const input = screen.getByLabelText("어떤 그림을 넣을지");
    for (const value of ["고", "고양", "고양이"]) {
      fireEvent.change(input, { target: { value } });
    }

    const typed = () =>
      api.searchMotifs.mock.calls
        .map(([call]) => call.body.query)
        .filter((query: string) => query.startsWith("고"));
    await waitFor(() => expect(typed()).toEqual(["고양이"]));
    // 중간 글자로는 한 번도 요청하지 않는다 — 디바운스가 앞선 타이머를 취소한다.
    expect(typed()).toEqual(["고양이"]);
    queryClient.clear();
  });

  it("글자 넣기 CTA는 만들기→적용으로 바뀌고 이전·수정이 되돌린다", async () => {
    api.previewTextMotif.mockResolvedValue({
      data: { svg: "<svg id='text'/>", warnings: [] },
    });
    const queryClient = renderPage();

    pickSource(
      await screen.findByRole("button", { name: "벌 바꾸기" }),
      1,
      /^글자 넣기/,
    );
    await waitForDialog("글자 넣기");
    const input = screen.getByLabelText("넣을 글자");
    // 빈 입력이면 CTA만 있고 잠겨 있다 — 필드 안 만들기 버튼은 없다.
    expect(
      disabled(screen.getByRole("button", { name: "이 글자로 만들기" })),
    ).toBe(true);

    fireEvent.change(input, { target: { value: "영선" } });
    fireEvent.click(screen.getByRole("button", { name: "이 글자로 만들기" }));

    await screen.findByRole("button", { name: "이 그림 적용" });
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    screen.getByRole("button", { name: "이 글자로 만들기" });

    // 글자를 고치면 낡은 결과가 비워져 CTA가 스스로 되돌아온다.
    fireEvent.click(screen.getByRole("button", { name: "이 글자로 만들기" }));
    await screen.findByRole("button", { name: "이 그림 적용" });
    fireEvent.change(input, { target: { value: "영선산업" } });
    screen.getByRole("button", { name: "이 글자로 만들기" });
    queryClient.clear();
  });

  it("사진에서 따오기는 파일 선택창보다 모달을 먼저 열어 되는 사진을 안내한다", async () => {
    const queryClient = renderPage();

    pickSource(
      await screen.findByRole("button", { name: "벌 바꾸기" }),
      1,
      /^사진에서 따오기/,
    );
    await waitForDialog("사진에서 따오기");

    // 고르기 전에 조건을 말한다 — 파일 선택창이 먼저 열리면 이 안내를 볼 자리가 없다.
    screen.getByText("이런 사진이 잘 돼요");
    screen.getByText(/풍경·인물 사진은 배경을 지울 수 없어요/);
    screen.getByRole("button", { name: "사진 고르기" });
    queryClient.clear();
  });

  it("검색 결과가 0건이면 안내만 남는다", async () => {
    api.searchMotifs.mockResolvedValue({ data: { results: [] } });
    const queryClient = renderPage();

    pickSource(
      await screen.findByRole("button", { name: "벌 바꾸기" }),
      1,
      /^탐색/,
    );
    await waitForDialog("탐색");
    const input = screen.getByLabelText("어떤 그림을 넣을지");
    fireEvent.change(input, { target: { value: "없는 그림" } });

    await screen.findByText("찾은 그림이 없어요");
    expect(
      disabled(screen.getByRole("button", { name: "이 그림으로 바꾸기" })),
    ).toBe(true);
    queryClient.clear();
  });

  it("생성 결과는 적용 전에 한 장으로 보여주고 내 모티프에 저장된다", async () => {
    api.generateMotif.mockResolvedValue({
      data: {
        request_id: "req-1",
        saved: true,
        motif: {
          motif_id: "fixture-bee",
          name: "작은 벌",
          preview_svg: "<svg/>",
        },
      },
    });
    const queryClient = renderPage();

    pickSource(
      await screen.findByRole("button", { name: "벌 바꾸기" }),
      1,
      /^AI 생성/,
    );
    await waitForDialog("AI 생성");
    fireEvent.change(screen.getByLabelText("새로 만들 그림"), {
      target: { value: "아주 작은 벌" },
    });
    fireEvent.click(screen.getByRole("button", { name: /이 문장으로 만들기/ }));

    await waitFor(() =>
      expect(api.generateMotif).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { prompt: "아주 작은 벌" },
        throwOnError: true,
      }),
    );
    // 결과는 한 장으로 남고, 적용은 사용자가 따로 누른다.
    await screen.findByText(
      "내 모티프에 저장했어요 — 적용하지 않아도 나중에 다시 고를 수 있어요",
    );
    expect(api.activateMotif).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "이 그림 적용" }));
    await waitFor(() =>
      expect(api.activateMotif).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { slot: 1, motif_id: "fixture-bee" },
        throwOnError: true,
      }),
    );
    queryClient.clear();
  });

  it("SVG 올리기는 모달을 열지 않고 슬롯에 바로 넣는다", async () => {
    api.importMotif.mockResolvedValue({
      data: {
        id: "user-motif-1",
        motif_id: "upload-a1b2c3d4e5f6",
        name: "bee",
        preview_svg: "<svg/>",
        created_at: "2026-07-31T00:00:00Z",
      },
    });
    const queryClient = renderPage();

    pickSource(
      await screen.findByRole("button", { name: "벌 바꾸기" }),
      1,
      /^SVG 올리기/,
    );
    // 파일 선택창만 열린다 — 열린 모달이 없으니 취소해도 닫힐 것이 없다.
    expect(openDialogs()).toEqual([]);

    // jsdom의 File에는 arrayBuffer()가 없다 — 읽기만 흉내 낸다.
    const file = new File(["<svg/>"], "bee.svg", { type: "image/svg+xml" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("<svg/>").buffer,
    });
    fireEvent.change(screen.getByLabelText("SVG 모티프 파일 선택"), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(api.activateMotif).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { slot: 1, motif_id: "upload-a1b2c3d4e5f6" },
        throwOnError: true,
      }),
    );
    expect(api.importMotif).toHaveBeenCalledWith({
      body: { name: "bee", svg: "<svg/>" },
      throwOnError: true,
    });
    expect(openDialogs()).toEqual([]);
    queryClient.clear();
  });

  // matchMedia가 min-width에 false라 이 스위트는 base 브레이크포인트(모바일 390) 렌더다.
  it("천 토큰부터 k 단위로 줄이고 줄바꿈하지 않는다", async () => {
    tokenBalance = 1_200;
    const queryClient = renderPage();

    const tokenButton = (await screen.findByText("1.2k토큰")).closest("button");
    expect(tokenButton?.className).toContain("whitespace-nowrap");
    queryClient.clear();
  });

  it("모바일에서는 토큰을 뷰 전환 아래에 두고 + 버튼으로 도구 시트를 연다", async () => {
    tokenBalance = 0;
    const queryClient = renderPage();

    await screen.findByLabelText("무엇을 바꿀까요?");
    const tokenButton = (await screen.findByText("0토큰")).closest("button");
    expect(tokenButton?.parentElement?.style.position).toBe("absolute");
    expect(tokenButton?.parentElement?.style.top).toBe("var(--spacing-x12)");
    expect(tokenButton?.parentElement?.style.right).toBe("0px");
    expect(
      screen.queryByRole("navigation", { name: "디자인 도구" }),
    ).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "디자인 도구 열기" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    await openMobileTools();
    expect(
      screen
        .getByRole("button", { name: "디자인 도구 열기" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    const menu = screen.getByRole("navigation", {
      name: "모바일 디자인 도구",
    });
    expect(menu.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
    expect(within(menu).getByRole("button", { name: "내려받기" })).toBeTruthy();
    expect(
      within(menu).getByRole("button", { name: "새로 시작" }),
    ).toBeTruthy();
    // 접기 토글·슬롯 메타는 모바일에서 숨어 접근성 트리에서도 빠진다(썸네일만 남는다).
    expect(
      screen.queryByRole("button", { name: "모티프 카드 접기" }),
    ).toBeNull();
    queryClient.clear();
  });
});
