// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  confirmPaymentMutation: () => ({ mutationFn: api.confirm }),
}));

import { usePaymentConfirm } from "./use-payment-confirm";

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter
      initialEntries={[
        "/order/payment/success?paymentKey=key&orderId=group&amount=100",
      ]}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe("payment confirm terminal failure", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    "not_payable",
    "not_found",
    "forbidden",
    "ownership_conflict",
  ])("%s 오류에서 pending 정리 콜백을 실행한다", async (code) => {
    api.confirm.mockRejectedValue({ code, detail: "terminal" });
    const onTerminalFailure = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { result } = renderHook(
      () =>
        usePaymentConfirm(async () => null, {
          onTerminalFailure,
        }),
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(onTerminalFailure).toHaveBeenCalledWith(
      {
        code,
        detail: "terminal",
      },
      "group",
    );
    queryClient.clear();
  });

  it("일시 오류에서는 pending 정리 콜백을 실행하지 않는다", async () => {
    api.confirm.mockRejectedValue({ code: "upstream_error" });
    const onTerminalFailure = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { result } = renderHook(
      () =>
        usePaymentConfirm(async () => null, {
          onTerminalFailure,
        }),
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(onTerminalFailure).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("확인 요청 중 렌더가 바뀌어도 시작 시점의 완료 핸들러를 사용한다", async () => {
    let finishConfirm:
      | ((value: { orders: []; token_amount: null }) => void)
      | undefined;
    api.confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishConfirm = resolve;
        }),
    );
    const firstHandler = vi.fn(async () => "first");
    const nextHandler = vi.fn(async () => "next");
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { result, rerender } = renderHook(
      ({ onConfirmed }) => usePaymentConfirm(onConfirmed),
      {
        initialProps: { onConfirmed: firstHandler },
        wrapper: wrapper(queryClient),
      },
    );

    await waitFor(() => expect(api.confirm).toHaveBeenCalledOnce());
    rerender({ onConfirmed: nextHandler });
    await act(async () => {
      finishConfirm?.({ orders: [], token_amount: null });
    });

    await waitFor(() => expect(result.current.confirmed).toBe(true));
    expect(firstHandler).toHaveBeenCalledWith(
      { orders: [], token_amount: null },
      "group",
    );
    expect(nextHandler).not.toHaveBeenCalled();
    queryClient.clear();
  });
});
