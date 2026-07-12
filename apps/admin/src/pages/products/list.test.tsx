import type { PageAdminProductSummaryOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ list: vi.fn(), options: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  adminListProductsOptions: (options: unknown) => {
    api.options(options);
    return {
      queryKey: ["admin-products", options],
      queryFn: () => api.list(options),
    };
  },
}));

import { ProductsPage } from "./list";

const page: PageAdminProductSummaryOut = {
  items: [
    {
      id: 17,
      code: "3F-20260712-001",
      name: "네이비 솔리드 타이",
      price: 39000,
      image: "https://assets.example/product.webp",
      category: "3fold",
      color: "navy",
      pattern: "solid",
      material: "silk",
      stock: null,
      option_label: "길이",
      option_count: 2,
      option_stock_total: 7,
      created_at: "2026-07-12T01:00:00Z",
      updated_at: "2026-07-12T02:00:00Z",
    },
  ],
  total: 51,
  limit: 50,
  offset: 50,
};

function renderPage(entry = "/products") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <ProductsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProductsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue(page);
  });

  it("검색·분류·정렬·페이지를 서버 목록 계약으로 전달한다", async () => {
    renderPage(
      "/products?q=navy&category=3fold&color=navy&pattern=solid&material=silk&page=2&limit=50&sort=price&direction=asc",
    );

    expect(
      await screen.findByRole("table", { name: "상품 목록" }),
    ).toBeTruthy();
    expect(api.options).toHaveBeenCalledWith({
      query: {
        category: "3fold",
        color: "navy",
        pattern: "solid",
        material: "silk",
        q: "navy",
        sort: "price",
        direction: "asc",
        limit: 50,
        offset: 50,
      },
    });
    expect(
      await screen.findByRole("link", { name: "네이비 솔리드 타이" }),
    ).toBeTruthy();
  });

  it("필터 변경 시 첫 페이지 서버 조회로 복귀한다", async () => {
    const user = userEvent.setup();
    renderPage("/products?page=2");
    await screen.findByText("네이비 솔리드 타이");

    await user.selectOptions(screen.getByLabelText("카테고리"), "knit");

    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ category: "knit", offset: 0 }),
        }),
      ),
    );
  });
});
