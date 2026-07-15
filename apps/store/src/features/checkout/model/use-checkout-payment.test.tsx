// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@essesion/shared", () => ({ snackbar: vi.fn() }));

import type { PaymentWidgetHandle } from "../ui/payment-widget";
import {
  CHECKOUT_PENDING_KEY,
  CHECKOUT_PENDING_TTL_MS,
  readPendingCheckout,
  useCheckoutPayment,
} from "./use-checkout-payment";

function paymentWidget(): PaymentWidgetHandle {
  return {
    setAmount: vi.fn().mockResolvedValue(undefined),
    requestPayment: vi.fn().mockResolvedValue(undefined),
  };
}

describe("checkout pending ownership", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => vi.useRealTimers());

  it("A의 pending을 B가 재사용하지 않고 B 주문을 새로 만든다", async () => {
    const createOrder = vi
      .fn()
      .mockResolvedValueOnce({ paymentGroupId: "payment-a", totalAmount: 100 })
      .mockResolvedValueOnce({ paymentGroupId: "payment-b", totalAmount: 100 });
    const widget = paymentWidget();
    const { result, rerender } = renderHook(
      ({ ownerUserId }) =>
        useCheckoutPayment({
          ownerUserId,
          storageKey: CHECKOUT_PENDING_KEY,
          snapshot: { cartItemIds: ["cart-1"] },
          orderName: "주문",
          createOrder,
        }),
      { initialProps: { ownerUserId: "user-a" as string | null } },
    );

    await act(() => result.current.pay(widget));
    rerender({ ownerUserId: "user-b" });
    await act(() => result.current.pay(widget));

    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")?.paymentGroupId,
    ).toBe("payment-a");
    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-b")?.paymentGroupId,
    ).toBe("payment-b");
  });

  it("TTL 직전에는 재사용하고 경계 시각부터 새 주문을 만든다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
    const createOrder = vi
      .fn()
      .mockResolvedValueOnce({ paymentGroupId: "payment-1", totalAmount: 100 })
      .mockResolvedValueOnce({ paymentGroupId: "payment-2", totalAmount: 100 });
    const widget = paymentWidget();
    const { result } = renderHook(() =>
      useCheckoutPayment({
        ownerUserId: "user-a",
        storageKey: CHECKOUT_PENDING_KEY,
        snapshot: { cartItemIds: ["cart-1"] },
        orderName: "주문",
        createOrder,
      }),
    );

    await act(() => result.current.pay(widget));
    vi.setSystemTime(Date.now() + CHECKOUT_PENDING_TTL_MS - 1);
    await act(() => result.current.pay(widget));
    expect(createOrder).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    await act(() => result.current.pay(widget));
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")?.paymentGroupId,
    ).toBe("payment-2");
  });

  it("금액 설정 중 계정이 바뀌면 이전 계정의 Toss 결제를 시작하지 않는다", async () => {
    let finishSetAmount: (() => void) | undefined;
    const widget = paymentWidget();
    vi.mocked(widget.setAmount).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSetAmount = resolve;
        }),
    );
    const createOrder = vi
      .fn()
      .mockResolvedValue({ paymentGroupId: "payment-a", totalAmount: 100 });
    const { result, rerender } = renderHook(
      ({ ownerUserId }) =>
        useCheckoutPayment({
          ownerUserId,
          storageKey: CHECKOUT_PENDING_KEY,
          snapshot: { cartItemIds: ["cart-a"] },
          orderName: "주문",
          createOrder,
        }),
      { initialProps: { ownerUserId: "user-a" as string | null } },
    );

    let pay: Promise<void> | undefined;
    act(() => {
      pay = result.current.pay(widget);
    });
    await waitFor(() => expect(widget.setAmount).toHaveBeenCalledWith(100));
    rerender({ ownerUserId: "user-b" });
    await act(async () => {
      finishSetAmount?.();
      await pay;
    });

    expect(widget.requestPayment).not.toHaveBeenCalled();
    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")?.paymentGroupId,
    ).toBe("payment-a");
  });

  it("주문 생성 중 화면이 unmount되면 뒤늦게 Toss 결제를 시작하지 않는다", async () => {
    let finishCreateOrder:
      | ((value: { paymentGroupId: string; totalAmount: number }) => void)
      | undefined;
    const createOrder = vi.fn(
      () =>
        new Promise<{ paymentGroupId: string; totalAmount: number }>(
          (resolve) => {
            finishCreateOrder = resolve;
          },
        ),
    );
    const widget = paymentWidget();
    const { result, unmount } = renderHook(() =>
      useCheckoutPayment({
        ownerUserId: "user-a",
        storageKey: CHECKOUT_PENDING_KEY,
        snapshot: { cartItemIds: ["cart-a"] },
        orderName: "주문",
        createOrder,
      }),
    );

    let pay: Promise<void> | undefined;
    act(() => {
      pay = result.current.pay(widget);
    });
    await waitFor(() => expect(createOrder).toHaveBeenCalledOnce());
    unmount();
    await act(async () => {
      finishCreateOrder?.({ paymentGroupId: "payment-a", totalAmount: 100 });
      await pay;
    });

    expect(widget.setAmount).not.toHaveBeenCalled();
    expect(widget.requestPayment).not.toHaveBeenCalled();
    expect(
      readPendingCheckout(CHECKOUT_PENDING_KEY, "user-a")?.paymentGroupId,
    ).toBe("payment-a");
  });
});
