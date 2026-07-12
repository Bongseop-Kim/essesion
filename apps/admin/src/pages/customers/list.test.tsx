import type { PageAdminCustomerSummaryOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@essesion/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@essesion/api-client")>();
  return {
    ...original,
    listAdminCustomers: api.list,
    searchAdminCustomers: api.search,
  };
});

import { CustomersPage } from "./list";

const page: PageAdminCustomerSummaryOut = {
  items: [
    {
      id: "customer-1",
      email: "customer@example.com",
      name: "홍길동",
      phone: "01012345678",
      is_active: true,
      phone_verified: true,
      created_at: "2026-07-12T01:00:00Z",
      token_balance: 12,
      order_count: 3,
      active_coupon_count: 1,
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

function renderPage(entry = "/customers") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <CustomersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CustomersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ data: page });
    api.search.mockResolvedValue({ data: page });
  });

  it("customer 전용 페이지 계약과 비민감 URL 필터를 전달한다", async () => {
    renderPage(
      "/customers?page=2&limit=50&status=inactive&sort=name&direction=desc",
    );

    expect(
      await screen.findByRole("table", { name: "고객 목록" }),
    ).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          status: "inactive",
          sort: "name",
          direction: "desc",
          limit: 50,
          offset: 50,
        },
        throwOnError: true,
      }),
    );
  });

  it("PII 검색어를 query string이 아닌 request body로만 보낸다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("홍길동");

    await user.type(
      screen.getByLabelText("이름·이메일·전화번호 검색"),
      "01012345678",
    );
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() =>
      expect(api.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ q: "01012345678" }),
          throwOnError: true,
        }),
      ),
    );
    expect(api.list).toHaveBeenCalledTimes(1);
  });
});
