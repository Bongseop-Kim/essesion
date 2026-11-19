// @vitest-environment jsdom

import type { MeResponse } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireAuth: vi.fn(() => false),
}));

vi.mock("@/features/auth/ui/auth-guard-provider", () => ({
  useAuthGuard: () => ({ requireAuth: auth.requireAuth }),
}));

vi.mock("@/features/custom-order/model/use-custom-quote", () => ({
  useCustomQuote: () => ({
    data: { total_cost: 100_000, sewing_cost: 60_000, fabric_cost: 40_000 },
    isCurrent: true,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import {
  readCustomOrderFormDraft,
  saveCustomOrderFormDraft,
} from "@/features/custom-order/model/draft";
import { DEFAULT_CUSTOM_ORDER_OPTIONS } from "@/features/custom-order/model/options";
import { useSession } from "@/shared/store/session";

import { CustomOrderPage } from "./index";

function user(id: string): MeResponse {
  return {
    id,
    name: `user-${id}`,
    email: `${id}@example.com`,
    phone: null,
    phone_verified: false,
    birth: null,
    role: "customer",
    notification_enabled: true,
    notification_consent: true,
    marketing_kakao_sms_consent: false,
    created_at: "2026-07-13T00:00:00.000Z",
  };
}

describe("CustomOrderPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireAuth.mockReturnValue(false);
    sessionStorage.clear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useSession.setState({ status: "anonymous", accessToken: null, user: null });
  });

  it("stale A 사용자가 남은 loading 중에는 A draft를 렌더하거나 저장하지 않는다", async () => {
    saveCustomOrderFormDraft("user-a", {
      options: {
        ...DEFAULT_CUSTOM_ORDER_OPTIONS,
        additionalNotes: "account-a-secret",
      },
    });
    useSession.setState({
      status: "loading",
      accessToken: "access-b",
      user: user("user-a"),
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <MemoryRouter initialEntries={["/custom-order"]}>
        <QueryClientProvider client={queryClient}>
          <CustomOrderPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByDisplayValue("account-a-secret")).toBeNull();
    const notes = screen.getByLabelText("추가 요청사항");
    expect((notes as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(notes, { target: { value: "edited-during-loading" } });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    });

    expect(readCustomOrderFormDraft("user-a")?.options.additionalNotes).toBe(
      "account-a-secret",
    );
    expect(readCustomOrderFormDraft(null)).toBeNull();
    queryClient.clear();
  });

  it("같은 메타데이터의 두 번째 첨부를 선택하면 두 번째 파일만 제거한다", async () => {
    auth.requireAuth.mockReturnValue(true);
    const first = new File(["same"], "duplicate.png", {
      type: "image/png",
      lastModified: 1,
    });
    const second = new File(["same"], "duplicate.png", {
      type: "image/png",
      lastModified: 1,
    });
    const createObjectURL = vi.fn((blob: Blob) =>
      blob === first ? "blob:first" : "blob:second",
    );
    const BrowserURL = URL;
    class ObjectURL extends BrowserURL {}
    ObjectURL.createObjectURL = createObjectURL;
    const revokeObjectURL = vi.fn();
    ObjectURL.revokeObjectURL = revokeObjectURL;
    vi.stubGlobal("URL", ObjectURL);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <MemoryRouter initialEntries={["/custom-order"]}>
        <QueryClientProvider client={queryClient}>
          <CustomOrderPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    fireEvent.change(
      screen.getByLabelText("이미지 추가", { selector: "input" }),
      { target: { files: [first, second] } },
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "duplicate.png 삭제" }),
      ).toHaveLength(2),
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "duplicate.png 삭제" })[1]!,
    );

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "duplicate.png 삭제" }),
      ).toHaveLength(1),
    );
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second");
    queryClient.clear();
  });

  it("색·로고에서 넘긴 디자인 PNG가 참고 이미지로 들어온다", async () => {
    const design = new File(["png"], "design.png", { type: "image/png" });
    const BrowserURL = URL;
    class ObjectURL extends BrowserURL {}
    ObjectURL.createObjectURL = vi.fn(() => "blob:design");
    ObjectURL.revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", ObjectURL);
    const queryClient = new QueryClient();

    render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/custom-order", state: { designFiles: [design] } },
        ]}
      >
        <QueryClientProvider client={queryClient}>
          <CustomOrderPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "design.png 삭제" });
    queryClient.clear();
  });

  it("자수·필름 주문은 넥타이 칸 대신 로고 칸만, 브랜드 라벨을 고르면 라벨 칸을 더한다", () => {
    render(
      <MemoryRouter initialEntries={["/custom-order"]}>
        <QueryClientProvider client={new QueryClient()}>
          <CustomOrderPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const slot = (label: string) =>
      screen.queryByLabelText(`${label} 참고 이미지 추가`);

    expect(slot("대검")).not.toBeNull();
    expect(slot("소검")).not.toBeNull();
    expect(slot("브랜드 라벨")).toBeNull();
    expect(slot("로고")).toBeNull();

    fireEvent.click(screen.getByLabelText("브랜드 라벨"));
    expect(slot("브랜드 라벨")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("자수·필름"));
    expect(slot("대검")).toBeNull();
    expect(slot("소검")).toBeNull();
    expect(slot("로고")).not.toBeNull();
    expect(slot("브랜드 라벨")).not.toBeNull();
  });

  it("구매·견적·견적서 버튼을 한 줄에 두고 100개부터는 구매 전에 견적을 권한다", async () => {
    auth.requireAuth.mockReturnValue(true);
    // jsdom에는 dialog의 showModal이 없다 — 확인 창이 열렸는지는 open 속성으로 본다.
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
    saveCustomOrderFormDraft(null, {
      options: { ...DEFAULT_CUSTOM_ORDER_OPTIONS, tieWidth: 8, quantity: 99 },
    });
    render(
      <MemoryRouter initialEntries={["/custom-order"]}>
        <QueryClientProvider client={new QueryClient()}>
          <CustomOrderPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const bulkDialog = () =>
      screen.getByText("견적으로 요청하시겠어요?").closest("dialog");

    expect(screen.getByRole("button", { name: "견적하기" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "견적서 메일로 받기" }),
    ).toBeTruthy();
    // 수량과 무관하게 주문서에는 견적 연락처 칸이 없다
    fireEvent.click(screen.getByRole("button", { name: "100개" }));
    expect(screen.queryByLabelText(/담당자 성함/)).toBeNull();
    expect(bulkDialog()?.hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "구매하기" }));

    await waitFor(() => expect(bulkDialog()?.hasAttribute("open")).toBe(true));
  });

  it("자수·필름 주문은 타이 종류와 라벨만 고르게 하고 단계 번호를 이어 매긴다", () => {
    // 앞 테스트의 화면이 문서에 남아 있어 이 렌더 안에서만 찾는다
    const { container } = render(
      <MemoryRouter initialEntries={["/custom-order"]}>
        <QueryClientProvider client={new QueryClient()}>
          <CustomOrderPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const view = within(container);
    expect(view.queryByLabelText(/넥타이 폭/)).not.toBeNull();
    expect(view.getByRole("heading", { name: "6. 추가 정보" })).toBeTruthy();

    fireEvent.click(view.getByLabelText("자수·필름"));

    for (const hidden of [
      /넥타이 폭/,
      "성인용",
      "울 심지",
      "삼각 봉제",
      "옆선 봉제",
      "바택 처리",
      "딤플",
      "돌려묶기",
      "스포데라토",
      "7폴드",
    ]) {
      expect(view.queryByLabelText(hidden)).toBeNull();
    }
    expect(view.queryByLabelText("자동 타이")).not.toBeNull();
    expect(view.queryByLabelText("브랜드 라벨")).not.toBeNull();
    expect(view.queryByLabelText("케어 라벨")).not.toBeNull();
    // 포인트 주문은 원단 직접 제공과 함께 고를 수 없다
    expect(
      (view.getByLabelText("원단 직접 제공") as HTMLInputElement).disabled,
    ).toBe(true);
    // 사양 단계가 빠져도 번호가 건너뛰지 않는다
    expect(view.getByRole("heading", { name: "4. 마감" })).toBeTruthy();
    expect(view.getByRole("heading", { name: "5. 추가 정보" })).toBeTruthy();
  });
});
