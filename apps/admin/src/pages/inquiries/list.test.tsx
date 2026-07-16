import type { PageAdminInquirySummaryOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
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

function renderPage(initialEntry = "/inquiries") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [{ path: "/inquiries", element: <InquiriesPage /> }],
    { initialEntries: [initialEntry] },
  );
  return {
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

describe("InquiriesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ data: page });
    api.search.mockResolvedValue({ data: page });
  });

  it("문의 검색어를 URL이 아닌 POST body로만 전송한다", async () => {
    const user = userEvent.setup();
    const { router } = renderPage("/inquiries?from=2026-07-01&to=2026-07-12");
    await screen.findByText("배송 문의");

    const searchInput = screen.getByLabelText("제목·내용 검색");
    const searchForm = searchInput.closest("form");
    expect(searchForm?.style.width).toBe("100%");
    expect((searchForm?.firstElementChild as HTMLElement).style.flex).toBe(
      "1 1 0%",
    );
    expect((searchForm?.firstElementChild as HTMLElement).style.minWidth).toBe(
      "0",
    );

    await user.type(searchInput, "급한 배송");
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() =>
      expect(api.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            q: "급한 배송",
            start_date: "2026-07-01",
            end_date: "2026-07-12",
          }),
          throwOnError: true,
        }),
      ),
    );
    expect(router.state.location.search).not.toContain("급한");
    expect(screen.getByText("1–1 / 총 1건")).toBeTruthy();
    expect(screen.getByText("페이지당 20개")).toBeTruthy();

    await user.click(
      screen.getByRole("button", {
        name: "검색: 급한 배송 필터 제거",
      }),
    );
    expect((searchInput as HTMLInputElement).value).toBe("");

    await user.type(searchInput, "재검색");
    await user.click(screen.getByRole("button", { name: "검색" }));
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "전체 초기화" }));

    expect((searchInput as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("group", { name: "적용된 필터" })).toBeNull();
  });

  it("페이지 크기가 바뀌면 새 limit으로 다시 조회한다", async () => {
    const { router } = renderPage("/inquiries?limit=20");
    await screen.findByText("배송 문의");

    await act(async () => {
      await router.navigate("/inquiries?limit=50");
    });

    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ limit: 50 }),
          throwOnError: true,
        }),
      ),
    );
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("답변 상태·분류 필터 초안을 취소하거나 함께 적용한다", async () => {
    const user = userEvent.setup();
    renderPage("/inquiries?status=답변대기&type=일반");
    await screen.findByText("배송 문의");

    await user.click(screen.getByRole("button", { name: "필터 2" }));
    await user.click(screen.getByRole("radio", { name: "답변완료" }));
    await user.click(screen.getByRole("radio", { name: "상품" }));
    await user.click(screen.getByRole("button", { name: "취소" }));

    await user.click(screen.getByRole("button", { name: "필터 2" }));
    expect(
      (screen.getByRole("radio", { name: "답변대기" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByRole("radio", { name: "일반" }) as HTMLInputElement).checked,
    ).toBe(true);
    await user.click(screen.getByRole("radio", { name: "답변완료" }));
    await user.click(screen.getByRole("radio", { name: "상품" }));
    fireEvent.change(screen.getByLabelText("시작일 (KST)"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("종료일 (KST)"), {
      target: { value: "2026-07-12" },
    });
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            status: "답변완료",
            category: "상품",
            start_date: "2026-07-01",
            end_date: "2026-07-12",
            offset: 0,
          }),
        }),
      ),
    );
  });

  it("페이지 전환 중 이전 행과 새 범위를 함께 표시하지 않는다", async () => {
    let resolveNext:
      | ((value: { data: PageAdminInquirySummaryOut }) => void)
      | undefined;
    api.list
      .mockResolvedValueOnce({ data: { ...page, total: 40 } })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNext = resolve;
        }),
      );
    const { router } = renderPage();
    await screen.findByText("배송 문의");

    await act(async () => {
      await router.navigate("/inquiries?page=2");
    });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));

    expect(screen.getByText("문의 목록 불러오는 중")).toBeTruthy();
    expect(screen.queryByText("배송 문의")).toBeNull();
    expect(screen.queryByText(/총 40건/)).toBeNull();

    await act(async () => {
      resolveNext?.({ data: { ...page, total: 40, offset: 20 } });
    });
    expect(await screen.findByText("21–40 / 총 40건")).toBeTruthy();
  });
});
