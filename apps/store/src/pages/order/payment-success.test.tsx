// @vitest-environment jsdom

import type { MeResponse, PaymentConfirmResponse } from "@essesion/api-client";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConfirmedHandler = (
  result: PaymentConfirmResponse,
  paymentGroupId: string,
) => Promise<unknown>;

const confirmHarness = vi.hoisted(() => ({
  onConfirmed: null as ConfirmedHandler | null,
}));
const cartHarness = vi.hoisted(() => ({ removeItems: vi.fn() }));

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

vi.mock("@/features/cart", () => ({
  useCartActions: () => ({ removeItems: cartHarness.removeItems }),
}));

import { CHECKOUT_PENDING_KEY, readPendingCheckout } from "@/features/checkout";
import {
  DEFAULT_CUSTOM_ORDER_OPTIONS,
  DEFAULT_QUOTE_CONTACT,
  readCustomOrderFormDraft,
  saveCustomOrderFormDraft,
} from "@/features/custom-order";
import { useSession } from "@/shared/store/session";

import { PaymentSuccessPage } from "./payment-success";

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

function savePending(
  ownerUserId: string,
  paymentGroupId: string,
  cartItemId: string,
) {
  sessionStorage.setItem(
    `${CHECKOUT_PENDING_KEY}:user:${encodeURIComponent(ownerUserId)}`,
    JSON.stringify({
      ownerUserId,
      paymentGroupId,
      totalAmount: 100,
      createdAt: Date.now(),
      signature: paymentGroupId,
      snapshot: { cartItemIds: [cartItemId], customOrder: {} },
    }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PaymentSuccessPage />
    </MemoryRouter>,
  );
}

const confirmed: PaymentConfirmResponse = { orders: [], token_amount: null };

describe("payment success pending boundary", () => {
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

  it("A 확인 중 B로 바뀌어도 A의 matching pending만 정리한다", async () => {
    savePending("user-a", "group-a", "cart-a");
    savePending("user-b", "group-b", "cart-b");
    saveCustomOrderFormDraft("user-a", {
      options: DEFAULT_CUSTOM_ORDER_OPTIONS,
      contact: DEFAULT_QUOTE_CONTACT,
    });
    saveCustomOrderFormDraft("user-b", {
      options: DEFAULT_CUSTOM_ORDER_OPTIONS,
      contact: { ...DEFAULT_QUOTE_CONTACT, contactName: "account-b" },
    });
    renderPage();

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
    expect(readCustomOrderFormDraft("user-a")).toBeNull();
    expect(readCustomOrderFormDraft("user-b")?.contact.contactName).toBe(
      "account-b",
    );
    expect(cartHarness.removeItems).not.toHaveBeenCalled();
  });

  it("A 확인 화면 unmount 후 B가 로그인해도 B 장바구니와 draft를 건드리지 않는다", async () => {
    savePending("user-a", "group-a", "product:1:base");
    savePending("user-b", "group-b", "product:1:base");
    saveCustomOrderFormDraft("user-a", {
      options: DEFAULT_CUSTOM_ORDER_OPTIONS,
      contact: DEFAULT_QUOTE_CONTACT,
    });
    saveCustomOrderFormDraft("user-b", {
      options: DEFAULT_CUSTOM_ORDER_OPTIONS,
      contact: { ...DEFAULT_QUOTE_CONTACT, contactName: "account-b" },
    });
    const page = renderPage();

    page.unmount();
    useSession.setState({
      status: "authenticated",
      accessToken: "access-b",
      user: user("user-b"),
    });
    await act(async () => {
      await confirmHarness.onConfirmed?.(confirmed, "group-a");
    });

    expect(cartHarness.removeItems).not.toHaveBeenCalled();
    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-b")?.paymentGroupId,
    ).toBe("group-b");
    expect(readCustomOrderFormDraft("user-b")?.contact.contactName).toBe(
      "account-b",
    );
  });

  it("동일 계정 토큰 교체가 끝나면 A 후처리를 이어간다", async () => {
    savePending("user-a", "group-a", "cart-a");
    saveCustomOrderFormDraft("user-a", {
      options: DEFAULT_CUSTOM_ORDER_OPTIONS,
      contact: DEFAULT_QUOTE_CONTACT,
    });
    renderPage();

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
    expect(readCustomOrderFormDraft("user-a")).not.toBeNull();
    expect(cartHarness.removeItems).not.toHaveBeenCalled();

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
    expect(readCustomOrderFormDraft("user-a")).toBeNull();
    expect(cartHarness.removeItems).toHaveBeenCalledWith(["cart-a"]);
  });

  it("B 토큰 확인 전에는 보존하고 B 확정 후 A 상태만 정리한다", async () => {
    savePending("user-a", "group-a", "product:1:base");
    savePending("user-b", "group-b", "product:1:base");
    saveCustomOrderFormDraft("user-a", {
      options: DEFAULT_CUSTOM_ORDER_OPTIONS,
      contact: DEFAULT_QUOTE_CONTACT,
    });
    saveCustomOrderFormDraft("user-b", {
      options: DEFAULT_CUSTOM_ORDER_OPTIONS,
      contact: { ...DEFAULT_QUOTE_CONTACT, contactName: "account-b" },
    });
    const page = renderPage();

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
    expect(readCustomOrderFormDraft("user-a")).not.toBeNull();
    expect(readCustomOrderFormDraft("user-b")?.contact.contactName).toBe(
      "account-b",
    );
    expect(cartHarness.removeItems).not.toHaveBeenCalled();

    useSession.setState({
      status: "authenticated",
      accessToken: "access-b",
      user: user("user-b"),
    });
    await act(async () => {
      await completion;
    });

    expect(readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")).toBeNull();
    expect(readCustomOrderFormDraft("user-a")).toBeNull();
    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-b")?.paymentGroupId,
    ).toBe("group-b");
    expect(readCustomOrderFormDraft("user-b")?.contact.contactName).toBe(
      "account-b",
    );
    expect(cartHarness.removeItems).not.toHaveBeenCalled();
  });

  it("성공 콜백 그룹과 다른 최신 pending은 정리하지 않는다", async () => {
    savePending("user-a", "group-new", "cart-new");
    renderPage();

    await act(async () => {
      await confirmHarness.onConfirmed?.(confirmed, "group-old");
    });

    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")?.paymentGroupId,
    ).toBe("group-new");
    expect(cartHarness.removeItems).not.toHaveBeenCalled();
  });
});
