import type { AdminQuoteDetailOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  getAdminQuoteOptions: () => ({ queryKey: ["quote"], queryFn: api.get }),
  getAdminQuoteQueryKey: () => ["quote"],
  listAdminQuotesQueryKey: () => ["quotes"],
  updateAdminQuoteStatusMutation: () => ({ mutationFn: api.update }),
  createAdminQuoteImageReadUrlMutation: () => ({ mutationFn: vi.fn() }),
}));

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
}));

import { QuoteDetailPage } from "./detail";

const quote: AdminQuoteDetailOut = {
  id: "quote-1",
  quote_number: "Q-001",
  status: "요청",
  quantity: 100,
  business_name: "테스트 상사",
  quoted_amount: null,
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:00Z",
  customer: {
    id: "customer-1",
    name: "홍길동",
    email: "customer@example.com",
    phone: "01012345678",
  },
  admin_actions: [
    {
      target_status: "견적발송",
      label: "견적발송(으)로 변경",
      enabled: true,
    },
  ],
  shipping_address_id: null,
  shipping_address: null,
  options: { material: "silk" },
  additional_notes: "빠른 납기",
  contact_name: "홍길동",
  contact_method: "phone",
  contact_value: "01012345678",
  quote_conditions: null,
  admin_memo: null,
  images: [],
  status_logs: [],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/quote-requests/quote-1"]}>
        <Routes>
          <Route
            path="/quote-requests/:quoteId"
            element={<QuoteDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("QuoteDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(quote);
  });

  it("stale 오류에도 금액·조건 입력과 expected_updated_at을 보존한다", async () => {
    const user = userEvent.setup();
    api.update.mockRejectedValue(new Error("최신 내용을 다시 확인해 주세요."));
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "견적발송(으)로 변경" }),
    );
    await user.type(screen.getByLabelText("견적 금액"), "120000");
    await user.type(screen.getByLabelText("견적 조건"), "배송비 포함");
    await user.click(screen.getByRole("button", { name: "변경 내용 확인" }));
    await user.click(screen.getByRole("button", { name: "변경" }));

    expect(await screen.findByText("견적을 변경하지 못했습니다")).toBeTruthy();
    expect((screen.getByLabelText("견적 금액") as HTMLInputElement).value).toBe(
      "120000",
    );
    expect(
      (screen.getByLabelText("견적 조건") as HTMLTextAreaElement).value,
    ).toBe("배송비 포함");
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            expected_updated_at: quote.updated_at,
            new_status: "견적발송",
            quoted_amount: 120000,
          }),
        }),
        expect.anything(),
      ),
    );
  });
});
