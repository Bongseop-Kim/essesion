// @vitest-environment jsdom

import type { OrderDetailOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ detail: vi.fn(), confirm: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  getOrderOptions: () => ({ queryKey: ["order"], queryFn: api.detail }),
  getOrderQueryKey: () => ["order"],
  listMyOrdersQueryKey: () => ["orders"],
  confirmPurchaseMutation: () => ({ mutationFn: api.confirm }),
}));

import { OrderDetailPage } from "./detail";

const order: OrderDetailOut = {
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
  customer_actions: ["claim_cancel"],
  shipping_address: null,
  claim_summary: {
    claim_number: "CLM-001",
    type: "cancel",
    status: "완료",
  },
  items: [
    {
      id: "item-1",
      item_id: "product-1",
      item_type: "product",
      product_id: 1,
      selected_option_id: null,
      item_data: null,
      quantity: 1,
      unit_price: 10_000,
      discount_amount: 0,
      line_discount_amount: 0,
      applied_user_coupon_id: null,
      claim: {
        claim_number: "CLM-001",
        type: "cancel",
        status: "완료",
      },
    },
  ],
};

describe("OrderDetailPage", () => {
  beforeEach(() => {
    api.detail.mockResolvedValue(order);
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

  it("완료된 취소를 표시하고 같은 항목의 취소 요청을 숨긴다", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <MemoryRouter initialEntries={["/order/order-1"]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/order/:orderId" element={<OrderDetailPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "ORD-001", level: 1 }),
    ).toBeTruthy();
    expect(screen.getAllByText("취소 완료")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "취소 요청" })).toBeNull();
  });
});
