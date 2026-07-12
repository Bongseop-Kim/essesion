import type { PageAdminInquirySummaryOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ list: vi.fn(), search: vi.fn() }));

vi.mock("@essesion/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@essesion/api-client")>();
  return {
    ...original,
    listAdminInquiries: api.list,
    searchAdminInquiries: api.search,
  };
});

import { InquiriesPage } from "./list";

const page: PageAdminInquirySummaryOut = {
  items: [
    {
      id: "inquiry-1",
      title: "배송 문의",
      category: "일반",
      status: "답변대기",
      answer_date: null,
      created_at: "2026-07-12T01:00:00Z",
      updated_at: "2026-07-12T01:00:00Z",
      customer: { id: "customer-1", name: "홍길동", email: null, phone: null },
      product: null,
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/inquiries"]}>
        <InquiriesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("InquiriesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ data: page });
    api.search.mockResolvedValue({ data: page });
  });

  it("문의 검색어를 URL이 아닌 POST body로만 전송한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("배송 문의");

    await user.type(screen.getByLabelText("제목·내용 검색"), "급한 배송");
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() =>
      expect(api.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ q: "급한 배송" }),
          throwOnError: true,
        }),
      ),
    );
    expect(window.location.search).not.toContain("급한");
  });
});
