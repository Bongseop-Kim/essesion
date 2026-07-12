import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ create: vi.fn() }));
const image = vi.hoisted(() => ({ upload: vi.fn(), discard: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  adminCreateProductMutation: () => ({ mutationFn: api.create }),
  adminListProductsQueryKey: () => ["admin-products"],
}));

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
}));

vi.mock("./upload", () => ({
  uploadProductImage: image.upload,
  discardProductImageUpload: image.discard,
}));

import { ProductNewPage } from "./new";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/products/new"]}>
        <ProductNewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProductNewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    image.upload.mockResolvedValue({
      uploadId: "00000000-0000-4000-8000-000000000101",
      publicUrl: "https://assets.example/new-product.webp",
    });
  });

  it("완료된 staged 이미지 ID와 상품 정보를 한 create 요청으로 확정한다", async () => {
    const user = userEvent.setup();
    api.create.mockRejectedValueOnce(new Error("일시적인 상품 저장 실패"));
    renderPage();

    await user.type(screen.getByLabelText(/상품 이름/), "새 실크 타이");
    await user.type(screen.getByLabelText(/상품 설명/), "새 상품 설명");
    await user.type(screen.getByLabelText(/기본 가격/), "45000");
    const file = new File(["image"], "product.webp", {
      type: "image/webp",
    });
    const imageInput = screen
      .getAllByLabelText("대표 이미지 추가")
      .find((element) => element instanceof HTMLInputElement);
    expect(imageInput).toBeTruthy();
    await user.upload(imageInput as HTMLInputElement, file);

    await waitFor(() =>
      expect(image.upload).toHaveBeenCalledWith(file, "primary"),
    );
    await user.click(screen.getByRole("button", { name: "상품 등록" }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            name: "새 실크 타이",
            price: 45000,
            image_upload_id: "00000000-0000-4000-8000-000000000101",
            detail_image_upload_ids: [],
            options: [],
            stock: null,
          }),
        }),
        expect.anything(),
      ),
    );
    expect(await screen.findByText("일시적인 상품 저장 실패")).toBeTruthy();
    expect((screen.getByLabelText(/상품 이름/) as HTMLInputElement).value).toBe(
      "새 실크 타이",
    );
  });
});
