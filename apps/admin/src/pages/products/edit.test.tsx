import type { AdminProductDetailOut } from "@essesion/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  adminGetProductOptions: ({ path }: { path: { product_id: number } }) => ({
    queryKey: ["admin-product", path.product_id],
    queryFn: () => api.get(path.product_id),
  }),
  adminGetProductQueryKey: ({ path }: { path: { product_id: number } }) => [
    "admin-product",
    path.product_id,
  ],
  adminListProductsQueryKey: () => ["admin-products"],
  adminUpdateProductMutation: () => ({ mutationFn: api.update }),
}));

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
}));

vi.mock("./upload", () => ({
  uploadProductImage: vi.fn(),
  discardProductImageUpload: vi.fn(),
}));

import { ProductEditPage } from "./edit";

const product: AdminProductDetailOut = {
  id: 17,
  code: "3F-20260712-001",
  name: "네이비 솔리드 타이",
  price: 39000,
  image: "https://assets.example/product.webp",
  image_upload_id: "00000000-0000-4000-8000-000000000101",
  detail_images: ["https://assets.example/product-detail.webp"],
  detail_image_upload_ids: ["00000000-0000-4000-8000-000000000102"],
  category: "3fold",
  color: "navy",
  pattern: "solid",
  material: "silk",
  info: "실크 상품 설명",
  stock: null,
  option_label: "길이",
  option_count: 1,
  option_stock_total: 4,
  options: [
    {
      id: "00000000-0000-4000-8000-000000000201",
      name: "긴 길이",
      additional_price: 1000,
      stock: 4,
    },
  ],
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T02:00:00Z",
};

function renderPage(showProductSwitch = false) {
  return renderAdminPage(
    <>
      {showProductSwitch && <Link to="/products/18/edit">다음 상품</Link>}
      <Routes>
        <Route path="/products/:productId/edit" element={<ProductEditPage />} />
      </Routes>
    </>,
    { entry: "/products/17/edit" },
  );
}

describe("ProductEditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockReset().mockResolvedValue(product);
    api.update.mockReset();
  });

  it("캐시된 다른 상품 route로 이동하면 draft와 revision을 새 상품으로 교체한다", async () => {
    const user = userEvent.setup();
    const nextProduct = {
      ...product,
      id: 18,
      code: "3F-20260712-002",
      name: "두 번째 상품",
      updated_at: "2026-07-12T04:00:00Z",
    };
    api.get.mockImplementation((productId: number) =>
      Promise.resolve(productId === nextProduct.id ? nextProduct : product),
    );
    const { queryClient } = renderPage(true);
    await screen.findByDisplayValue(product.name);
    queryClient.setQueryData(["admin-product", 18], nextProduct);

    await user.click(screen.getByRole("link", { name: "다음 상품" }));

    expect(
      await screen.findByRole("heading", { name: nextProduct.name }),
    ).toBeTruthy();
    expect((screen.getByLabelText(/상품 이름/) as HTMLInputElement).value).toBe(
      nextProduct.name,
    );
  });

  it("stale 실패 후 입력·option ID·기준 revision을 보존하고 서버 값을 비교한다", async () => {
    const user = userEvent.setup();
    const serverProduct = {
      ...product,
      name: "서버에서 먼저 바뀐 이름",
      updated_at: "2026-07-12T03:00:00Z",
    };
    api.update.mockRejectedValueOnce(
      new Error("다른 관리자가 먼저 상품을 변경했습니다"),
    );
    api.get.mockResolvedValueOnce(product).mockResolvedValueOnce(serverProduct);
    renderPage();

    const name = await screen.findByLabelText(/상품 이름/);
    await user.clear(name);
    await user.type(name, "내가 입력한 상품 이름");
    await user.click(screen.getByRole("button", { name: "상품 변경 저장" }));

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { product_id: 17 },
          body: expect.objectContaining({
            expected_updated_at: product.updated_at,
            name: "내가 입력한 상품 이름",
            options: [
              expect.objectContaining({
                id: "00000000-0000-4000-8000-000000000201",
                name: "긴 길이",
              }),
            ],
          }),
        }),
        expect.anything(),
      ),
    );
    const submittedBody = api.update.mock.calls[0]?.[0]?.body;
    expect(submittedBody).not.toHaveProperty("image_upload_id");
    expect(submittedBody).not.toHaveProperty("detail_image_upload_ids");
    expect(
      await screen.findByText("다른 관리자가 먼저 상품을 변경했습니다"),
    ).toBeTruthy();
    expect((name as HTMLInputElement).value).toBe("내가 입력한 상품 이름");

    await user.click(screen.getByRole("button", { name: "최신 서버 값 비교" }));
    expect(await screen.findByText("현재 서버 값")).toBeTruthy();
    expect(screen.getAllByText("서버에서 먼저 바뀐 이름")).toHaveLength(2);
    expect((name as HTMLInputElement).value).toBe("내가 입력한 상품 이름");
  });

  it("동명 옵션을 클라이언트에서 막고 서버 mutation을 실행하지 않는다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText(/상품 이름/);

    await user.click(screen.getByRole("button", { name: "옵션 추가" }));
    const optionNames = screen.getAllByLabelText(/옵션 이름/);
    await user.type(optionNames[1] as HTMLInputElement, "긴 길이");
    await user.click(screen.getByRole("button", { name: "상품 변경 저장" }));

    expect(
      screen.getAllByText("같은 옵션 이름을 중복할 수 없습니다."),
    ).toHaveLength(2);
    expect(api.update).not.toHaveBeenCalled();
  });

  it("관계 ID가 없는 legacy 이미지를 표시하고 미변경 PATCH에서 이미지 필드를 생략한다", async () => {
    const user = userEvent.setup();
    const legacyProduct = {
      ...product,
      image: "https://legacy.example/primary.webp",
      image_upload_id: null,
      detail_images: ["https://legacy.example/detail.webp"],
      detail_image_upload_ids: [],
    };
    api.get.mockResolvedValue(legacyProduct);
    api.update.mockRejectedValueOnce(new Error("테스트 응답"));
    renderPage();

    expect(
      (await screen.findByAltText("상품 대표 이미지")).getAttribute("src"),
    ).toBe(legacyProduct.image);
    expect(screen.getByAltText("상품 상세 이미지 1").getAttribute("src")).toBe(
      legacyProduct.detail_images[0],
    );
    const name = screen.getByLabelText(/상품 이름/);
    await user.clear(name);
    await user.type(name, "legacy 이미지 보존 상품");
    await user.click(screen.getByRole("button", { name: "상품 변경 저장" }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const body = api.update.mock.calls[0]?.[0]?.body;
    expect(body).not.toHaveProperty("image_upload_id");
    expect(body).not.toHaveProperty("detail_image_upload_ids");
  });

  it("legacy 상세 이미지를 명시적으로 모두 제거하면 빈 ID 목록을 PATCH한다", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({
      ...product,
      image_upload_id: null,
      detail_image_upload_ids: [],
    });
    api.update.mockRejectedValueOnce(new Error("테스트 응답"));
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "상품 상세 이미지 1 삭제" }),
    );
    await user.click(screen.getByRole("button", { name: "상품 변경 저장" }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const body = api.update.mock.calls[0]?.[0]?.body;
    expect(body).not.toHaveProperty("image_upload_id");
    expect(body).toHaveProperty("detail_image_upload_ids", []);
  });
});
