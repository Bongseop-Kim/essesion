import type {
  AdminCapabilitiesOut,
  AdminOrderSummaryOut,
  DashboardRecentOrdersPage,
  DashboardRecentQuoteOut,
  DashboardRecentQuotesPage,
  DashboardSummaryOut,
} from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  capabilities: vi.fn(),
  summary: vi.fn(),
  orders: vi.fn(),
  quotes: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  getAdminCapabilitiesOptions: () => ({
    queryKey: ["admin-capabilities"],
    queryFn: api.capabilities,
  }),
  getDashboardSummaryOptions: (_options: unknown) => ({
    queryKey: ["dashboard-summary"],
    queryFn: api.summary,
  }),
  getDashboardRecentOrdersOptions: (_options: unknown) => ({
    queryKey: ["dashboard-orders"],
    queryFn: api.orders,
  }),
  getDashboardRecentQuotesOptions: (_options: unknown) => ({
    queryKey: ["dashboard-quotes"],
    queryFn: api.quotes,
  }),
}));

import { DashboardPage } from "./dashboard";

const summary: DashboardSummaryOut = {
  as_of: "2026-07-12T01:00:00Z",
  start_date: "2026-07-12",
  end_date: "2026-07-12",
  order_type: "all",
  order_amount: 50_000,
  order_count: 1,
  open_claim_count: 2,
  unanswered_inquiry_count: 3,
  open_payment_incident_count: 0,
};

const capabilities: AdminCapabilitiesOut = {
  toss: "real",
  gcs: "real",
  gcs_assets: "real",
  solapi: "real",
  admin_edge_proxy: "ready",
};

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

const quote: DashboardRecentQuoteOut = {
  id: "quote-1",
  quote_number: "QUOTE-001",
  business_name: "테스트 상사",
  quoted_amount: 100_000,
  status: "접수",
  created_at: "2026-07-12T01:00:00Z",
  customer: order.customer,
};

const ordersPage: DashboardRecentOrdersPage = {
  items: [order],
  total: 1,
  limit: 5,
  offset: 0,
  as_of: summary.as_of,
};

const quotesPage: DashboardRecentQuotesPage = {
  items: [quote],
  total: 1,
  limit: 5,
  offset: 0,
  as_of: summary.as_of,
};

function pendingPromise() {
  return new Promise<never>(() => undefined);
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("로딩 중에도 route heading과 native table 의미론을 유지한다", () => {
    api.summary.mockReturnValue(pendingPromise());
    api.orders.mockReturnValue(pendingPromise());
    api.quotes.mockReturnValue(pendingPromise());
    api.capabilities.mockReturnValue(pendingPromise());

    renderPage();

    expect(
      screen.getByRole("heading", { name: "대시보드", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByRole("table", { name: "최근 주문" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "최근 견적" })).toBeTruthy();
    expect(screen.getByText("최근 주문 불러오는 중")).toBeTruthy();
  });

  it("지표와 최근 항목을 표시하고 한 번의 새로고침으로 세 쿼리를 다시 요청한다", async () => {
    const user = userEvent.setup();
    api.summary.mockResolvedValue(summary);
    api.orders.mockResolvedValue(ordersPage);
    api.quotes.mockResolvedValue(quotesPage);
    api.capabilities.mockResolvedValue(capabilities);
    renderPage();

    expect(await screen.findByText("ORDER-001")).toBeTruthy();
    expect(screen.getByText("QUOTE-001")).toBeTruthy();
    expect(screen.getAllByText("₩50,000")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "새로고침" }));

    await waitFor(() => {
      expect(api.summary).toHaveBeenCalledTimes(2);
      expect(api.orders).toHaveBeenCalledTimes(2);
      expect(api.quotes).toHaveBeenCalledTimes(2);
      expect(api.capabilities).toHaveBeenCalledTimes(2);
    });
  });

  it("필수 연동 불가 상태를 운영자에게 경고한다", async () => {
    api.summary.mockResolvedValue(summary);
    api.orders.mockResolvedValue(ordersPage);
    api.quotes.mockResolvedValue(quotesPage);
    api.capabilities.mockResolvedValue({
      ...capabilities,
      toss: "unavailable",
      solapi: "dry-run",
    });
    renderPage();

    expect(
      await screen.findByText("필수 연동을 사용할 수 없습니다"),
    ).toBeTruthy();
    expect(screen.getByText(/Toss 결제 관련 작업은 실패 상태/)).toBeTruthy();
    expect(screen.getByText("로컬·대체 연동 모드")).toBeTruthy();
    expect(screen.getByText(/Solapi 알림: dry-run/)).toBeTruthy();
  });
});
