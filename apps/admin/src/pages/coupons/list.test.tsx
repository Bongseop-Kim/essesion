import type { AdminCouponOut, PageAdminCouponOut } from "@essesion/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  options: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  listAdminCouponsOptions: (options: unknown) => {
    api.options(options);
    return { queryKey: ["coupons", options], queryFn: api.list };
  },
}));

import { CouponsPage } from "./list";

const coupon: AdminCouponOut = {
  id: "coupon-1",
  name: "여름 할인",
  display_name: "여름맞이 10% 할인",
  discount_type: "percentage",
  discount_value: "10",
  max_discount_amount: "5000",
  description: null,
  expiry_date: "2027-08-31",
  additional_info: null,
  is_active: true,
  issued_count: 12,
  active_issued_count: 8,
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:00Z",
};

const page: PageAdminCouponOut = {
  items: [coupon],
  total: 1,
  limit: 50,
  offset: 50,
};

function renderPage(entry = "/coupons") {
  return renderAdminPage(<CouponsPage />, { entry });
}

describe("CouponsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue(page);
  });

  it("비민감 URL 상태만 생성 쿼리에 전달하고 쿠폰 조건을 표시한다", async () => {
    renderPage(
      "/coupons?page=2&limit=50&status=active&sort=name&direction=desc&q=customer@example.com",
    );

    expect(
      screen.getByRole("heading", { name: "쿠폰 관리", level: 1 }),
    ).toBeTruthy();
    expect(await screen.findByText("여름 할인")).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
    expect(api.options).toHaveBeenCalledWith({
      query: {
        q: undefined,
        status: "active",
        start_date: undefined,
        end_date: undefined,
        sort: "name",
        direction: "desc",
        limit: 50,
        offset: 50,
      },
    });
  });

  it("조회 결과가 없으면 명시적인 빈 상태를 표시한다", async () => {
    api.list.mockResolvedValue({ ...page, items: [], total: 0 });
    renderPage();

    expect(await screen.findByText("조건에 맞는 쿠폰이 없습니다")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "쿠폰 목록" })).toBeNull();
  });

  it("검색과 등록일 필터를 적용하고 칩·전체 초기화로 해제한다", async () => {
    const user = userEvent.setup();
    renderPage("/coupons?page=2");
    await screen.findByText("여름 할인");

    await user.type(
      screen.getByLabelText("쿠폰명·표시명·쿠폰 ID 검색"),
      "여름 할인",
    );
    await user.click(screen.getByRole("button", { name: "검색" }));
    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ q: "여름 할인", offset: 0 }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "필터" }));
    await user.type(screen.getByLabelText("시작일 (KST)"), "2026-07-01");
    await user.type(screen.getByLabelText("종료일 (KST)"), "2026-07-12");
    await user.click(screen.getByRole("button", { name: "필터 적용" }));
    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          q: "여름 할인",
          start_date: "2026-07-01",
          end_date: "2026-07-12",
          offset: 0,
        }),
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "등록 종료일: 2026-07-12 필터 제거",
      }),
    );
    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          start_date: "2026-07-01",
          end_date: undefined,
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          q: undefined,
          start_date: undefined,
          end_date: undefined,
        }),
      }),
    );
    expect(
      (screen.getByLabelText("쿠폰명·표시명·쿠폰 ID 검색") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("상태 필터 초안은 취소하면 버리고 적용할 때 조회한다", async () => {
    const user = userEvent.setup();
    renderPage("/coupons?status=active");
    await screen.findByText("여름 할인");

    const requestCount = api.list.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "필터 1" }));
    await user.click(screen.getByRole("radio", { name: "비활성" }));
    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(api.list).toHaveBeenCalledTimes(requestCount);

    await user.click(screen.getByRole("button", { name: "필터 1" }));
    expect(
      (screen.getByRole("radio", { name: "활성" }) as HTMLInputElement).checked,
    ).toBe(true);
    await user.click(screen.getByRole("radio", { name: "비활성" }));
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ status: "inactive", offset: 0 }),
      }),
    );
  });
});
