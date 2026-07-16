import type { PageAdminCustomerSummaryOut } from "@essesion/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderAdminPage } from "../../test/render-admin-page";

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

function LocationProbe() {
  return <output aria-label="현재 URL">{useLocation().search}</output>;
}

function renderPage(entry = "/customers") {
  return renderAdminPage(
    <>
      <CustomersPage />
      <LocationProbe />
    </>,
    { entry },
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
          start_date: undefined,
          end_date: undefined,
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
    renderPage("/customers?from=2026-07-01&to=2026-07-12");
    await screen.findByText("홍길동");

    const searchInput = screen.getByLabelText("이름·이메일·전화번호 검색");
    const searchForm = searchInput.closest("form");
    expect(searchForm?.style.width).toBe("100%");
    expect((searchForm?.firstElementChild as HTMLElement).style.flex).toBe(
      "1 1 0%",
    );
    expect((searchForm?.firstElementChild as HTMLElement).style.minWidth).toBe(
      "0",
    );

    await user.type(searchInput, "01012345678");
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() =>
      expect(api.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            q: "01012345678",
            start_date: "2026-07-01",
            end_date: "2026-07-12",
          }),
          throwOnError: true,
        }),
      ),
    );
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("현재 URL").textContent).not.toContain(
      "01012345678",
    );
    expect(
      screen.getByRole("button", {
        name: "검색: 01012345678 필터 제거",
      }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "전체 초기화" }));

    expect(
      (screen.getByLabelText("이름·이메일·전화번호 검색") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(screen.queryByRole("group", { name: "적용된 필터" })).toBeNull();
    expect(screen.getByLabelText("현재 URL").textContent).not.toContain(
      "01012345678",
    );
  });

  it("필터 패널에서 계정 상태를 적용하면 URL과 조회에 반영한다", async () => {
    const user = userEvent.setup();
    renderPage("/customers?status=inactive");
    await screen.findByText("홍길동");

    expect(
      screen.getByRole("button", { name: "상태: 비활성 필터 제거" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "필터 1" }));
    await user.click(screen.getByRole("radio", { name: "활성" }));
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            status: "active",
            offset: 0,
          }),
          throwOnError: true,
        }),
      ),
    );
    expect(screen.getByLabelText("현재 URL").textContent).toContain(
      "status=active",
    );
  });
});
