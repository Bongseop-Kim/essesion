// @vitest-environment jsdom

import type { MeResponse, PaymentConfirmResponse } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConfirmedHandler = (
  result: PaymentConfirmResponse,
  paymentGroupId: string,
) => Promise<unknown>;

const confirmHarness = vi.hoisted(() => ({
  onConfirmed: null as ConfirmedHandler | null,
}));

vi.mock("@/features/checkout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/checkout")>();
  return {
    ...actual,
    usePaymentConfirm: (onConfirmed: ConfirmedHandler) => {
      confirmHarness.onConfirmed = onConfirmed;
      return {
        valid: true,
        confirmed: false,
        failed: false,
        data: null,
        isPending: true,
        retry: vi.fn(),
      };
    },
  };
});

import { CHECKOUT_PENDING_KEY, readPendingCheckout } from "@/features/checkout";
import { useSession } from "@/shared/store/session";

import { TokenPurchaseSuccessPage } from "./success";

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

function savePending(ownerUserId: string, paymentGroupId: string) {
  sessionStorage.setItem(
    `${CHECKOUT_PENDING_KEY}:user:${encodeURIComponent(ownerUserId)}`,
    JSON.stringify({
      ownerUserId,
      paymentGroupId,
      totalAmount: 100,
      createdAt: Date.now(),
      signature: paymentGroupId,
      snapshot: {},
    }),
  );
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

const confirmed: PaymentConfirmResponse = { orders: [], token_amount: 10 };

describe("token payment success pending boundary", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    confirmHarness.onConfirmed = null;
    useSession.setState({
      status: "authenticated",
      accessToken: "access-a",
      user: user("user-a"),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useSession.setState({ status: "anonymous", accessToken: null, user: null });
  });

  it("A 확인 중 B로 바뀌어도 B pending과 B 쿼리를 건드리지 않는다", async () => {
    savePending("user-a", "group-a");
    savePending("user-b", "group-b");
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const PageWrapper = wrapper(queryClient);
    render(<TokenPurchaseSuccessPage />, { wrapper: PageWrapper });

    act(() => {
      useSession.setState({
        status: "authenticated",
        accessToken: "access-b",
        user: user("user-b"),
      });
    });
    await act(async () => {
      await confirmHarness.onConfirmed?.(confirmed, "group-a");
    });

    expect(readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")).toBeNull();
    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-b")?.paymentGroupId,
    ).toBe("group-b");
    expect(invalidate).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("A 확인 화면 unmount 후 B가 로그인해도 B pending과 토큰 캐시를 건드리지 않는다", async () => {
    savePending("user-a", "group-a");
    savePending("user-b", "group-b");
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const PageWrapper = wrapper(queryClient);
    const page = render(<TokenPurchaseSuccessPage />, {
      wrapper: PageWrapper,
    });

    page.unmount();
    useSession.setState({
      status: "authenticated",
      accessToken: "access-b",
      user: user("user-b"),
    });
    await act(async () => {
      await confirmHarness.onConfirmed?.(confirmed, "group-a");
    });

    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-b")?.paymentGroupId,
    ).toBe("group-b");
    expect(invalidate).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("동일 계정 토큰 교체가 끝나면 A pending과 토큰 캐시를 후처리한다", async () => {
    savePending("user-a", "group-a");
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const PageWrapper = wrapper(queryClient);
    render(<TokenPurchaseSuccessPage />, { wrapper: PageWrapper });

    act(() => {
      useSession.setState({
        status: "loading",
        accessToken: "access-a-rotated",
        user: user("user-a"),
      });
    });
    let completion: Promise<unknown> | undefined;
    await act(async () => {
      completion = confirmHarness.onConfirmed?.(confirmed, "group-a");
      await Promise.resolve();
    });

    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")?.paymentGroupId,
    ).toBe("group-a");
    expect(invalidate).not.toHaveBeenCalled();

    act(() => {
      useSession.setState({
        status: "authenticated",
        accessToken: "access-a-rotated",
        user: user("user-a"),
      });
    });
    await act(async () => {
      await completion;
    });

    expect(readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: expect.any(Array),
    });
    queryClient.clear();
  });

  it("B 토큰 확인 전에는 보존하고 B 확정 후 A pending만 정리한다", async () => {
    savePending("user-a", "group-a");
    savePending("user-b", "group-b");
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const PageWrapper = wrapper(queryClient);
    const page = render(<TokenPurchaseSuccessPage />, {
      wrapper: PageWrapper,
    });

    page.unmount();
    useSession.setState({
      status: "loading",
      accessToken: "access-b",
      // 새 토큰의 getMe 완료 전에는 이전 A 사용자가 남아 있을 수 있다.
      user: user("user-a"),
    });
    let completion: Promise<unknown> | undefined;
    await act(async () => {
      completion = confirmHarness.onConfirmed?.(confirmed, "group-a");
      await Promise.resolve();
    });

    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")?.paymentGroupId,
    ).toBe("group-a");
    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-b")?.paymentGroupId,
    ).toBe("group-b");
    expect(invalidate).not.toHaveBeenCalled();

    useSession.setState({
      status: "authenticated",
      accessToken: "access-b",
      user: user("user-b"),
    });
    await act(async () => {
      await completion;
    });

    expect(readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")).toBeNull();
    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-b")?.paymentGroupId,
    ).toBe("group-b");
    expect(invalidate).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("성공 콜백 그룹과 다른 pending은 유지한다", async () => {
    savePending("user-a", "group-new");
    const queryClient = new QueryClient();
    const PageWrapper = wrapper(queryClient);
    render(<TokenPurchaseSuccessPage />, { wrapper: PageWrapper });

    await act(async () => {
      await confirmHarness.onConfirmed?.(confirmed, "group-old");
    });

    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")?.paymentGroupId,
    ).toBe("group-new");
    queryClient.clear();
  });
});
