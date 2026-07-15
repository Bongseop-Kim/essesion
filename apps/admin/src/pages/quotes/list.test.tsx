import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  options: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  listAdminQuotesOptions: (options: unknown) => {
    api.options(options);
    return { queryKey: ["quotes", options], queryFn: api.list };
  },
}));

import { QuotesPage } from "./list";

describe("QuotesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  it("견적번호와 필터 기간을 목록 조회에 함께 전달한다", async () => {
    const user = userEvent.setup();
    renderAdminPage(<QuotesPage />, { entry: "/quote-requests" });

    await screen.findByText("조건에 맞는 견적이 없습니다");
    await user.type(screen.getByLabelText("견적번호 검색"), "QUOTE-2026-001");
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() =>
      expect(api.options.mock.lastCall?.[0]).toEqual({
        query: expect.objectContaining({ q: "QUOTE-2026-001" }),
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
          q: "QUOTE-2026-001",
          start_date: "2026-07-01",
          end_date: "2026-07-12",
        }),
      }),
    );
  });
});
