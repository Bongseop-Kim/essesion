import type { PageAdminClaimSummaryOut } from "@essesion/api-client";
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
  adminListClaimsV2Options: (options: unknown) => {
    api.options(options);
    return { queryKey: ["claims"], queryFn: api.list };
  },
}));

import { ClaimsPage } from "./list";

const page: PageAdminClaimSummaryOut = {
  items: [
    {
      id: "claim-1",
      claim_number: "CLM-001",
      order_id: "order-1",
      order_number: "ORDER-001",
      type: "cancel",
      status: "접수",
      quantity: 1,
      reason: "단순 변심",
      created_at: "2026-07-12T01:00:00Z",
      updated_at: "2026-07-12T01:00:00Z",
      customer: {
        id: "customer-1",
        name: "홍길동",
        email: "customer@example.com",
        phone: null,
      },
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

function LocationProbe() {
  return <output aria-label="현재 URL">{useLocation().search}</output>;
}

describe("ClaimsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue(page);
  });

  it("상태·유형 필터 초안을 취소하면 버리고 적용할 때만 조회에 반영한다", async () => {
    const user = userEvent.setup();
    renderAdminPage(
      <>
        <ClaimsPage />
        <LocationProbe />
      </>,
      { entry: "/claims" },
    );
    await screen.findByText("CLM-001");

    const filterButton = screen.getByRole("button", { name: "필터" });
    await user.click(filterButton);
    await user.click(screen.getByRole("radio", { name: "처리중" }));
    await user.click(screen.getByRole("radio", { name: "반품" }));
    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.getByLabelText("현재 URL").textContent).toBe("");

    await user.click(filterButton);
    expect(screen.getByRole("radio", { name: "처리중" })).toHaveProperty(
      "checked",
      false,
    );
    await user.click(screen.getByRole("radio", { name: "처리중" }));
    await user.click(screen.getByRole("radio", { name: "반품" }));
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          status: "처리중",
          claim_type: "return",
        }),
      }),
    );
    expect(screen.getByLabelText("현재 URL").textContent).toContain(
      "type=return",
    );
  });
});
