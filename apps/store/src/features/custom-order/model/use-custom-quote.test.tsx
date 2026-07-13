// @vitest-environment jsdom

import type { CustomAmountRequest } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ calculate: vi.fn() }));

vi.mock("@essesion/api-client", () => ({
  calculateCustomOrder: api.calculate,
}));

import { useCustomQuote } from "./use-custom-quote";

function payload(quantity: number): CustomAmountRequest {
  return {
    quantity,
    options: {
      fabric_provided: false,
      design_type: "PRINTING",
      fabric_type: "POLY",
    },
  };
}

describe("useCustomQuote", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.calculate.mockResolvedValue({
      data: { fabric_cost: 100, sewing_cost: 200, total_cost: 300 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("현재 값이 유효해져도 debounced payload가 유효해질 때까지 요청하지 않는다", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { rerender } = renderHook(({ request }) => useCustomQuote(request), {
      initialProps: { request: payload(3) },
      wrapper,
    });

    rerender({ request: payload(4) });
    await act(() => vi.advanceTimersByTimeAsync(399));
    expect(api.calculate).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(api.calculate).toHaveBeenCalledTimes(1);
    expect(api.calculate).toHaveBeenCalledWith({
      body: payload(4),
      throwOnError: true,
    });
    queryClient.clear();
  });
});
