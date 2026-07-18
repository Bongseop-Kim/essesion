import type {
  AdminCapabilitiesOut,
  AdminOrderSummaryOut,
  DashboardRecentOrdersPage,
  DashboardRecentQuoteOut,
  DashboardRecentQuotesPage,
  DashboardSummaryOut,
  DashboardTimeseriesOut,
  DashboardTopProductsOut,
} from "@essesion/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../test/render-admin-page";

const api = vi.hoisted(() => ({
  capabilities: vi.fn(),
  summary: vi.fn(),
  timeseries: vi.fn(),
  topProducts: vi.fn(),
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
  getDashboardTimeseriesOptions: (_options: unknown) => ({
    queryKey: ["dashboard-timeseries"],
    queryFn: api.timeseries,
  }),
  getDashboardTopProductsOptions: (_options: unknown) => ({
    queryKey: ["dashboard-top-products"],
    queryFn: api.topProducts,
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
  worker: "real",
  finalize_tasks: "real",
  batch_auth: "oidc",
  oauth_google: "ready",
  oauth_kakao: "ready",
  auth_secrets: "ready",
  edge_proxy: "ready",
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

const timeseries: DashboardTimeseriesOut = {
  start_date: "2026-07-11",
  end_date: "2026-07-12",
  order_type: "all",
  points: [
    {
      day: "2026-07-11",
      order_count: 0,
      order_amount: 0,
      new_customer_count: 0,
      generation_total: 0,
      generation_failed: 0,
      token_consumed: 0,
      token_sold: 0,
    },
    {
      day: "2026-07-12",
      order_count: 1,
      order_amount: 50_000,
      new_customer_count: 2,
      generation_total: 4,
      generation_failed: 1,
      token_consumed: 30,
      token_sold: 100,
    },
  ],
  as_of: summary.as_of,
};

const topProductsPage: DashboardTopProductsOut = {
  start_date: "2026-07-11",
  end_date: "2026-07-12",
  items: [{ product_id: 1, name: "인기 넥타이", quantity: 3, amount: 90_000 }],
  as_of: summary.as_of,
};

function pendingPromise() {
  return new Promise<never>(() => undefined);
}

function renderPage() {
  return renderAdminPage(<DashboardPage />);
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("로딩 중에도 route heading과 native table 의미론을 유지한다", () => {
    api.summary.mockReturnValue(pendingPromise());
    api.timeseries.mockReturnValue(pendingPromise());
    api.topProducts.mockReturnValue(pendingPromise());
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

  it("지표와 최근 항목을 표시하고 한 번의 새로고침으로 모든 쿼리를 다시 요청한다", async () => {
    const user = userEvent.setup();
    api.summary.mockResolvedValue(summary);
    api.timeseries.mockResolvedValue(timeseries);
    api.topProducts.mockResolvedValue(topProductsPage);
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
      expect(api.timeseries).toHaveBeenCalledTimes(2);
      expect(api.topProducts).toHaveBeenCalledTimes(2);
      expect(api.orders).toHaveBeenCalledTimes(2);
      expect(api.quotes).toHaveBeenCalledTimes(2);
      expect(api.capabilities).toHaveBeenCalledTimes(2);
    });
  });

  it("일별 추이 차트 카드와 인기 상품 테이블을 렌더링한다", async () => {
    api.summary.mockResolvedValue(summary);
    api.timeseries.mockResolvedValue(timeseries);
    api.topProducts.mockResolvedValue(topProductsPage);
    api.orders.mockResolvedValue(ordersPage);
    api.quotes.mockResolvedValue(quotesPage);
    api.capabilities.mockResolvedValue(capabilities);
    renderPage();

    expect(await screen.findByText("매출 추이")).toBeTruthy();
    expect(screen.getByText("이미지 생성")).toBeTruthy();
    expect(screen.getByText("토큰 판매·소모")).toBeTruthy();
    // jsdom에서는 ResponsiveContainer 폭이 0이라 차트 내부(SVG)는 검증하지 않는다
    expect(screen.getByRole("table", { name: "인기 상품" })).toBeTruthy();
    expect(await screen.findByText("인기 넥타이")).toBeTruthy();
    expect(screen.getByText("1위")).toBeTruthy();
    expect(screen.getByText("₩90,000")).toBeTruthy();
  });

  it("필수 연동 불가 상태를 운영자에게 경고한다", async () => {
    api.summary.mockResolvedValue(summary);
    api.timeseries.mockResolvedValue(timeseries);
    api.topProducts.mockResolvedValue(topProductsPage);
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
