import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

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
  return renderAdminPage(<ProductNewPage />, { entry: "/products/new" });
}

function getImageInput(label: string) {
  return screen
    .getAllByLabelText(label)
    .find((element) => element instanceof HTMLInputElement) as HTMLInputElement;
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

    await user.click(screen.getByLabelText(/상품 이름/));
    await user.paste("새 실크 타이");
    await user.click(screen.getByLabelText(/상품 설명/));
    await user.paste("새 상품 설명");
    await user.click(screen.getByLabelText(/기본 가격/));
    await user.paste("45000");
    const file = new File(["image"], "product.webp", {
      type: "image/webp",
    });
    await user.upload(getImageInput("대표 이미지 추가"), file);

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

  it("유효하지 않은 제출은 첫 오류 필드로 focus를 이동한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "상품 등록" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/상품 이름/)),
    );
    expect(screen.getByText("입력한 상품 정보를 확인해 주세요")).toBeTruthy();
  });

  it("업로드 중 피커를 잠그고 unmount 뒤 완료된 staging을 폐기한다", async () => {
    const user = userEvent.setup();
    let completeUpload: (result: {
      uploadId: string;
      publicUrl: string;
    }) => void = () => undefined;
    image.upload.mockReturnValueOnce(
      new Promise((resolve) => {
        completeUpload = resolve;
      }),
    );
    const { unmount } = renderPage();
    const file = new File(["image"], "pending.webp", {
      type: "image/webp",
    });

    await user.upload(getImageInput("대표 이미지 추가"), file);
    await waitFor(() => expect(image.upload).toHaveBeenCalledTimes(1));
    expect(
      screen
        .queryAllByLabelText("대표 이미지 추가")
        .some((element) => element instanceof HTMLInputElement),
    ).toBe(false);

    unmount();
    completeUpload({
      uploadId: "00000000-0000-4000-8000-000000000199",
      publicUrl: "https://assets.example/orphan.webp",
    });
    await waitFor(() =>
      expect(image.discard).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000199",
      ),
    );
  });

  it("여러 상세 이미지 업로드 중 unmount하면 완료·진행 staging을 모두 폐기한다", async () => {
    const user = userEvent.setup();
    let completeSecond: (result: {
      uploadId: string;
      publicUrl: string;
    }) => void = () => undefined;
    image.upload
      .mockResolvedValueOnce({
        uploadId: "00000000-0000-4000-8000-000000000181",
        publicUrl: "https://assets.example/detail-1.webp",
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          completeSecond = resolve;
        }),
      );
    const { unmount } = renderPage();
    const files = [
      new File(["one"], "detail-1.webp", { type: "image/webp" }),
      new File(["two"], "detail-2.webp", { type: "image/webp" }),
    ];

    await user.upload(getImageInput("상세 이미지 추가"), files);
    await screen.findByAltText("상품 상세 이미지 1");
    await waitFor(() => expect(image.upload).toHaveBeenCalledTimes(2));

    unmount();
    completeSecond({
      uploadId: "00000000-0000-4000-8000-000000000182",
      publicUrl: "https://assets.example/detail-2.webp",
    });
    await waitFor(() => expect(image.discard).toHaveBeenCalledTimes(2));
    expect(image.discard).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000181",
    );
    expect(image.discard).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000182",
    );
  });

  it("StrictMode에서도 제거한 staging을 한 번만 폐기한다", async () => {
    const user = userEvent.setup();
    renderAdminPage(
      <StrictMode>
        <ProductNewPage />
      </StrictMode>,
      { entry: "/products/new" },
    );
    const file = new File(["image"], "product.webp", {
      type: "image/webp",
    });

    await user.upload(getImageInput("대표 이미지 추가"), file);
    await user.click(
      await screen.findByRole("button", { name: "상품 대표 이미지 삭제" }),
    );

    await waitFor(() => expect(image.discard).toHaveBeenCalledTimes(1));
  });
});
