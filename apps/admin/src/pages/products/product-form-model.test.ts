import { describe, expect, it } from "vitest";

import {
  emptyProductDraft,
  type ProductDraft,
  productFormValue,
  validateProductDraft,
} from "./product-form-model";

const validDraft: ProductDraft = {
  ...emptyProductDraft,
  name: "네이비 타이",
  price: "10000",
  info: "상품 설명",
  primaryImage: {
    clientId: "primary",
    uploadId: "upload-primary",
    src: "https://assets.example/primary.webp",
    staged: false,
  },
};

describe("product form model", () => {
  it("수정 시 바뀌지 않은 이미지 ID는 요청에서 생략한다", () => {
    expect(productFormValue(validDraft, validDraft, "edit")).not.toHaveProperty(
      "imageUploadId",
    );

    expect(
      productFormValue(
        {
          ...validDraft,
          detailImages: [
            {
              clientId: "detail",
              uploadId: "upload-detail",
              src: "https://assets.example/detail.webp",
              staged: true,
            },
          ],
        },
        validDraft,
        "edit",
      ),
    ).toMatchObject({ detailImages: [{ uploadId: "upload-detail" }] });
  });

  it("옵션 이름 중복과 재고 오류를 함께 반환한다", () => {
    const errors = validateProductDraft(
      {
        ...validDraft,
        optionLabel: "색상",
        options: [
          {
            clientId: "one",
            name: "네이비",
            additionalPrice: "0",
            stock: "",
            unlimitedStock: false,
          },
          {
            clientId: "two",
            name: "네이비",
            additionalPrice: "0",
            stock: "1",
            unlimitedStock: false,
          },
        ],
      },
      "edit",
    );

    expect(errors.options.one).toMatchObject({
      name: "같은 옵션 이름을 중복할 수 없습니다.",
      stock: "재고는 0 이상의 정수여야 합니다.",
    });
    expect(errors.options.two?.name).toBe(
      "같은 옵션 이름을 중복할 수 없습니다.",
    );
  });
});
