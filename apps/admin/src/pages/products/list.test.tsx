import type { PageAdminProductSummaryOut } from "@essesion/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickOption } from "../../test/pickers";
import { renderAdminPage } from "../../test/render-admin-page";

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
  return renderAdminPage(<ProductsPage />, { entry });
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
        start_date: undefined,
        end_date: undefined,
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

  it("검색과 등록일 필터를 적용하고 칩·전체 초기화로 해제한다", async () => {
    const user = userEvent.setup();
    renderPage("/products?page=2");
    await screen.findByText("네이비 솔리드 타이");

    await user.type(
      screen.getByLabelText("상품명·상품 코드 검색"),
      "TARGET-100",
    );
    await user.click(screen.getByRole("button", { name: "검색" }));
    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ q: "TARGET-100", offset: 0 }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "필터" }));
    await user.type(screen.getByLabelText("시작일 (KST)"), "2026-07-01");
    await user.type(screen.getByLabelText("종료일 (KST)"), "2026-07-12");
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          q: "TARGET-100",
          start_date: "2026-07-01",
          end_date: "2026-07-12",
          offset: 0,
        }),
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "등록 시작일: 2026-07-01 필터 제거",
      }),
    );
    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({
          start_date: undefined,
          end_date: "2026-07-12",
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
      (screen.getByLabelText("상품명·상품 코드 검색") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("필터 변경 시 첫 페이지 서버 조회로 복귀한다", async () => {
    const user = userEvent.setup();
    renderPage("/products?page=2");
    await screen.findByText("네이비 솔리드 타이");

    await user.click(screen.getByRole("button", { name: "필터" }));
    await user.click(screen.getByRole("radio", { name: "니트" }));
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ category: "knit", offset: 0 }),
        }),
      ),
    );
  });

  it("상세 필터 초안은 취소하면 버리고 적용하면 한 번에 조회한다", async () => {
    const user = userEvent.setup();
    renderPage("/products?color=navy");
    await screen.findByText("네이비 솔리드 타이");

    const requestCount = api.list.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "필터 1" }));
    await user.click(screen.getByRole("radio", { name: "블랙" }));
    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(api.list).toHaveBeenCalledTimes(requestCount);

    await user.click(screen.getByRole("button", { name: "필터 1" }));
    expect(
      (screen.getByRole("radio", { name: "네이비" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    await user.click(screen.getByRole("radio", { name: "블랙" }));
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ color: "black", offset: 0 }),
      }),
    );
  });

  it("페이지당 표시 선택을 페이지네이션에서 변경한다", async () => {
    const user = userEvent.setup();
    renderPage("/products?page=2&limit=50");
    await screen.findByText("네이비 솔리드 타이");

    await pickOption(user, "페이지당 표시", "100개");

    await waitFor(() =>
      expect(api.options).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ limit: 100, offset: 0 }),
      }),
    );
  });
});
