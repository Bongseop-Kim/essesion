import type {
  AdminOrderSummaryOut,
  PageAdminOrderSummaryOut,
} from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  options: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  listAllOrdersOptions: (options: unknown) => {
    api.options(options);
    return { queryKey: ["orders"], queryFn: api.list };
  },
}));

import { OrdersPage } from "./list";

const order: AdminOrderSummaryOut = {
  id: "order-1",
  order_number: "ORDER-001",
  order_type: "sale",
  order_amount: 50_000,
  payment_group_id: "payment-1",
  status: "진행중",
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:00Z",
  customer: {
    id: "customer-1",
    name: "홍길동",
    email: "customer@example.com",
    phone: null,
  },
};

const successPage: PageAdminOrderSummaryOut = {
  items: [order],
  total: 1,
  limit: 20,
  offset: 0,
};

const emptyPage: PageAdminOrderSummaryOut = {
  items: [],
  total: 0,
  limit: 20,
  offset: 0,
};

function renderPage(entry = "/orders") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <OrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OrdersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("route heading과 native table을 렌더링하고 URL 상태를 생성 클라이언트에 전달한다", async () => {
    api.list.mockResolvedValue(successPage);
    renderPage(
      "/orders?page=2&limit=50&type=sale&status=진행중&sort=status&direction=asc",
    );

    expect(
      screen.getByRole("heading", { name: "주문 관리", level: 1 }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("table", { name: "주문 목록" }),
    ).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /주문번호/ })).toBeTruthy();
    expect(api.options).toHaveBeenCalledWith({
      query: {
        order_type: "sale",
        status: "진행중",
        start_date: undefined,
        end_date: undefined,
        q: undefined,
        sort: "status",
        direction: "asc",
        limit: 50,
        offset: 50,
      },
    });
  });

  it("빈 응답에는 명시적인 empty state를 표시한다", async () => {
    api.list.mockResolvedValue(emptyPage);
    renderPage();

    expect(await screen.findByText("조건에 맞는 주문이 없습니다")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "주문 목록" })).toBeNull();
  });

  it("오류 상태에서 다시 시도해 성공 응답으로 복구한다", async () => {
    const user = userEvent.setup();
    api.list
      .mockRejectedValueOnce(new Error("목록 오류"))
      .mockResolvedValueOnce(successPage);
    renderPage();

    expect(await screen.findByText("목록을 불러오지 못했습니다")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("ORDER-001")).toBeTruthy();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });
});
