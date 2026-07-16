import type {
  AdminOrderSummaryOut,
  PageAdminOrderSummaryOut,
} from "@essesion/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

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
  claim_summary: {
    claim_number: "CLM-001",
    type: "cancel",
    status: "처리중",
  },
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

function LocationProbe() {
  return <output aria-label="현재 URL">{useLocation().search}</output>;
}

function renderPage(entry = "/orders") {
  return renderAdminPage(
    <>
      <OrdersPage />
      <LocationProbe />
    </>,
    { entry },
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
    expect(await screen.findByText("취소 처리중")).toBeTruthy();
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

  it("적용 필터를 사람이 읽는 칩으로 표시하고 한 번에 기본값으로 초기화한다", async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue(successPage);
    renderPage(
      "/orders?limit=50&type=repair&status=진행중&sort=status&direction=asc&from=2026-07-01&to=2026-07-12",
    );

    await screen.findByRole("table", { name: "주문 목록" });
    expect(screen.getByRole("button", { name: "필터 4" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "유형: 수선 필터 제거" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "상태: 진행중 필터 제거" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "전체 초기화" }));

    await waitFor(() =>
      expect(screen.getByLabelText("현재 URL").textContent).toBe(
        "?sort=created_at&direction=desc",
      ),
    );
    expect(screen.queryByRole("group", { name: "적용된 필터" })).toBeNull();
  });

  it("보조 필터 초안은 취소 시 버리고 적용할 때만 URL과 조회 조건에 반영한다", async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue(successPage);
    renderPage();

    await screen.findByRole("table", { name: "주문 목록" });
    const filterButton = screen.getByRole("button", { name: "필터" });
    await user.click(filterButton);
    await user.click(screen.getByRole("radio", { name: "진행중" }));
    await user.click(screen.getByRole("radio", { name: "수선" }));

    expect(screen.getByLabelText("현재 URL").textContent).toBe("");
    expect(api.options.mock.lastCall?.[0]).toEqual({
      query: expect.objectContaining({ order_type: "all" }),
    });

    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByLabelText("현재 URL").textContent).toBe("");

    await user.click(filterButton);
    expect(screen.getByRole("radio", { name: "진행중" })).toHaveProperty(
      "checked",
      false,
    );
    await user.click(screen.getByRole("radio", { name: "수선" }));
    await user.click(screen.getByRole("radio", { name: "진행중" }));
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(screen.getByLabelText("현재 URL").textContent).toBe(
        "?sort=created_at&direction=desc&status=%EC%A7%84%ED%96%89%EC%A4%91&type=repair",
      ),
    );
    expect(api.options.mock.lastCall?.[0]).toEqual({
      query: expect.objectContaining({
        order_type: "repair",
        status: "진행중",
      }),
    });
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

  it("응답 total을 벗어난 URL page를 마지막 page로 replace하고 다시 조회한다", async () => {
    api.list.mockResolvedValue(successPage);
    renderPage("/orders?page=999");

    await waitFor(() =>
      expect(screen.getByLabelText("현재 URL").textContent).toBe(
        "?sort=created_at&direction=desc",
      ),
    );
    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ offset: 0 }),
      }),
    );
  });
});
