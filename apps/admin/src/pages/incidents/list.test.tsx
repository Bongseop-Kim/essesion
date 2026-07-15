import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  options: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  adminListPaymentIncidentsOptions: (options: unknown) => {
    api.options(options);
    return { queryKey: ["incidents", options], queryFn: api.list };
  },
}));

import { IncidentsPage } from "./list";

function LocationProbe() {
  return <output aria-label="현재 URL">{useLocation().search}</output>;
}

function renderPage(entry = "/incidents") {
  return renderAdminPage(
    <>
      <IncidentsPage />
      <LocationProbe />
    </>,
    { entry },
  );
}

describe("IncidentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  it("결제 이상 식별자와 필터 기간을 목록 조회에 함께 전달한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("조건에 맞는 결제 이상이 없습니다");
    await user.type(
      screen.getByLabelText("결제 이상·요청 ID 검색"),
      "req-payment-001",
    );
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() =>
      expect(api.options.mock.lastCall?.[0]).toEqual({
        query: expect.objectContaining({ q: "req-payment-001" }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "필터" }));
    fireEvent.change(screen.getByLabelText("시작일 (KST)"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("종료일 (KST)"), {
      target: { value: "2026-07-12" },
    });
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.options.mock.lastCall?.[0]).toEqual({
        query: expect.objectContaining({
          q: "req-payment-001",
          start_date: "2026-07-01",
          end_date: "2026-07-12",
        }),
      }),
    );
  });

  it("상태·유형 초안은 취소 시 버리고 적용할 때만 URL과 조회 조건에 반영한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("조건에 맞는 결제 이상이 없습니다");
    const filterButton = screen.getByRole("button", { name: "필터" });
    await user.click(filterButton);
    let dialog = screen.getByRole("dialog", { name: "결제 이상 필터" });
    await user.click(within(dialog).getByRole("radio", { name: "해결" }));
    await user.click(within(dialog).getByRole("radio", { name: "환불" }));

    expect(screen.getByLabelText("현재 URL").textContent).toBe("");
    expect(api.options.mock.lastCall?.[0]).toEqual({
      query: expect.objectContaining({ incident_type: "all" }),
    });

    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByLabelText("현재 URL").textContent).toBe("");

    await user.click(filterButton);
    dialog = screen.getByRole("dialog", { name: "결제 이상 필터" });
    expect(
      within(
        within(dialog).getByRole("radiogroup", { name: "상태" }),
      ).getByRole("radio", { name: "미해결" }),
    ).toHaveProperty("checked", true);
    expect(
      within(
        within(dialog).getByRole("radiogroup", { name: "이상 유형" }),
      ).getByRole("radio", { name: "전체" }),
    ).toHaveProperty("checked", true);
    await user.click(within(dialog).getByRole("radio", { name: "해결" }));
    await user.click(within(dialog).getByRole("radio", { name: "환불" }));
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() => {
      const search = screen.getByLabelText("현재 URL").textContent ?? "";
      expect(search).toContain("status=resolved");
      expect(search).toContain("type=refund");
    });
    expect(api.options.mock.lastCall?.[0]).toEqual({
      query: expect.objectContaining({
        incident_type: "refund",
        status: "resolved",
      }),
    });
  });
});
