// @vitest-environment jsdom

import type { OrderOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  listMyOrdersOptions: () => ({ queryKey: ["orders"], queryFn: api.list }),
}));

import { OrderListPage } from "./orders";

const order: OrderOut = {
  id: "order-1",
  order_number: "ORD-001",
  order_type: "sale",
  status: "진행중",
  total_price: 10_000,
  original_price: 10_000,
  total_discount: 0,
  shipping_cost: 0,
  payment_group_id: "payment-1",
  shipping_address_id: null,
  courier_company: null,
  tracking_number: null,
  shipped_at: null,
  delivered_at: null,
  confirmed_at: null,
  company_courier_company: null,
  company_tracking_number: null,
  company_shipped_at: null,
  created_at: "2026-07-15T01:00:00Z",
  updated_at: "2026-07-15T01:00:00Z",
  customer_actions: [],
  claim_summary: {
    claim_number: "CLM-001",
    type: "cancel",
    status: "처리중",
  },
  items: [],
};

describe("OrderListPage", () => {
  beforeEach(() => {
    api.list.mockResolvedValue([order]);
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

  it("주문 상태와 클레임 요약을 함께 표시한다", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <OrderListPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("ORD-001", { exact: false })).toBeTruthy();
    expect(screen.getByText("진행중")).toBeTruthy();
    expect(screen.getByText("취소 처리중")).toBeTruthy();
  });
});
