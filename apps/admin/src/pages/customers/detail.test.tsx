import type {
  AdminCustomerDetailOut,
  AdminCustomerOrderOut,
  PageAdminCustomerCouponOut,
  PageAdminCustomerOrderOut,
} from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  orders: vi.fn(),
  coupons: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  getAdminCustomerOptions: () => ({
    queryKey: ["customer"],
    queryFn: api.detail,
  }),
  getAdminCustomerQueryKey: () => ["customer"],
  listAdminCustomerOrdersOptions: (options: { query: { offset: number } }) => ({
    queryKey: ["customer-orders", options.query.offset],
    queryFn: () => api.orders(options),
  }),
  listAdminCustomerOrdersQueryKey: () => ["customer-orders"],
  listAdminCustomerCouponsOptions: (options: {
    query: { offset: number };
  }) => ({
    queryKey: ["customer-coupons", options.query.offset],
    queryFn: () => api.coupons(options),
  }),
  listAdminCustomerCouponsQueryKey: () => ["customer-coupons"],
}));

import { CustomerDetailPage } from "./detail";

const customer: AdminCustomerDetailOut = {
  id: "customer-1",
  email: "customer@example.com",
  name: "홍길동",
  phone: "01012345678",
  is_active: true,
  phone_verified: true,
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:00Z",
  birth: null,
  notification_consent: true,
  notification_enabled: true,
  marketing_kakao_sms_consent: false,
  order_count: 0,
  active_coupon_count: 0,
};

const orders: PageAdminCustomerOrderOut = {
  items: [],
  total: 0,
  limit: 5,
  offset: 0,
};
const coupons: PageAdminCustomerCouponOut = {
  items: [],
  total: 0,
  limit: 5,
  offset: 0,
};

const lastOrder: AdminCustomerOrderOut = {
  id: "order-6",
  order_number: "ORD-0006",
  order_type: "product",
  total_price: 12000,
  status: "paid",
  created_at: "2026-07-12T01:00:00Z",
};

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location-path">{location.pathname}</output>
      <output data-testid="location-search">{location.search}</output>
    </>
  );
}

function renderPage(entry = "/customers/customer-1") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/customers/:userId",
        element: (
          <>
            <CustomerDetailPage />
            <LocationProbe />
          </>
        ),
      },
    ],
    { initialEntries: [entry] },
  );
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    queryClient,
    router,
  };
}

describe("CustomerDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.detail.mockResolvedValue(customer);
    api.orders.mockResolvedValue(orders);
    api.coupons.mockResolvedValue(coupons);
  });

  it("탭을 URL에 보존한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "홍길동", level: 1 });

    await user.click(screen.getByRole("tab", { name: "주문" }));
    expect(screen.getByTestId("location-search").textContent).toBe(
      "?tab=orders",
    );
    expect(
      screen.getByRole("tab", { name: "주문" }).getAttribute("aria-selected"),
    ).toBe("true");

    await user.click(screen.getByRole("tab", { name: "개요" }));
    expect(screen.getByTestId("location-search").textContent).toBe("");
  });

  it("이력 페이지가 범위를 넘으면 URL을 마지막 페이지로 보정하고 해당 행을 다시 조회한다", async () => {
    api.orders.mockImplementation(({ query }: { query: { offset: number } }) =>
      Promise.resolve({
        items: query.offset === 5 ? [lastOrder] : [],
        total: 6,
        limit: 5,
        offset: query.offset,
      } satisfies PageAdminCustomerOrderOut),
    );
    api.coupons.mockImplementation(({ query }: { query: { offset: number } }) =>
      Promise.resolve({ ...coupons, total: 11, offset: query.offset }),
    );

    renderPage(
      "/customers/customer-1?tab=orders&ordersPage=9&couponsPage=8&source=keep",
    );

    expect(await screen.findByText("ORD-0006")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("location-search").textContent).toBe(
        "?tab=orders&ordersPage=2&couponsPage=3&source=keep",
      ),
    );
    expect(screen.getByText("6–6 / 총 6건")).toBeTruthy();
    expect(api.orders).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ offset: 5 }),
      }),
    );
  });
});
