import type { AdminProductDetailOut } from "@essesion/api-client";

import type {
  ProductCategory,
  ProductColor,
  ProductMaterial,
  ProductPattern,
} from "./product-attributes";

export type ProductImageDraft = {
  clientId: string;
  uploadId: string | null;
  src: string;
  staged: boolean;
};

export type ProductOptionDraft = {
  clientId: string;
  id?: string;
  name: string;
  additionalPrice: string;
  stock: string;
  unlimitedStock: boolean;
};

export type ProductDraft = {
  name: string;
  code: string;
  price: string;
  category: ProductCategory;
  color: ProductColor;
  pattern: ProductPattern;
  material: ProductMaterial;
  info: string;
  stock: string;
  unlimitedStock: boolean;
  optionLabel: string;
  options: ProductOptionDraft[];
  primaryImage: ProductImageDraft | null;
  detailImages: ProductImageDraft[];
};

type ProductWithImageIds = AdminProductDetailOut & {
  image_upload_id: string | null;
  detail_image_upload_ids?: string[];
};

export const emptyProductDraft: ProductDraft = {
  name: "",
  code: "",
  price: "",
  category: "3fold",
  color: "navy",
  pattern: "solid",
  material: "silk",
  info: "",
  stock: "",
  unlimitedStock: true,
  optionLabel: "",
  options: [],
  primaryImage: null,
  detailImages: [],
};

export function productDraftFromDetail(
  product: ProductWithImageIds,
): ProductDraft {
  return {
    name: product.name,
    code: product.code ?? "",
    price: String(product.price),
    category: product.category as ProductCategory,
    color: product.color as ProductColor,
    pattern: product.pattern as ProductPattern,
    material: product.material as ProductMaterial,
    info: product.info,
    stock: product.stock === null ? "" : String(product.stock),
    unlimitedStock: product.stock === null,
    optionLabel: product.option_label ?? "",
    options: (product.options ?? []).map((option) => ({
      clientId: option.id,
      id: option.id,
      name: option.name,
      additionalPrice: String(option.additional_price),
      stock: option.stock === null ? "" : String(option.stock),
      unlimitedStock: option.stock === null,
    })),
    primaryImage:
      product.image_upload_id === null
        ? {
            clientId: "legacy-primary",
            uploadId: null,
            src: product.image,
            staged: false,
          }
        : {
            clientId: product.image_upload_id,
            uploadId: product.image_upload_id,
            src: product.image,
            staged: false,
          },
    detailImages: (product.detail_images ?? []).map((src, index) => {
      const uploadId = product.detail_image_upload_ids?.[index] ?? null;
      return {
        clientId: uploadId ?? `legacy-detail-${index}`,
        uploadId,
        src,
        staged: false,
      };
    }),
  };
}

export type ProductFormValue = {
  name: string;
  code: string | null;
  price: number;
  category: ProductCategory;
  color: ProductColor;
  pattern: ProductPattern;
  material: ProductMaterial;
  info: string;
  stock: number | null;
  optionLabel: string | null;
  options: Array<{
    id?: string;
    name: string;
    additionalPrice: number;
    stock: number | null;
  }>;
  imageUploadId?: string;
  detailImageUploadIds?: string[];
};

export type ProductDraftErrors = {
  name?: string;
  price?: string;
  info?: string;
  stock?: string;
  optionLabel?: string;
  primaryImage?: string;
  options: Record<
    string,
    { name?: string; additionalPrice?: string; stock?: string }
  >;
};

function nonNegativeInteger(value: string) {
  if (!/^\d+$/.test(value)) return undefined;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

export function validateProductDraft(
  draft: ProductDraft,
  mode: "create" | "edit",
): ProductDraftErrors {
  const errors: ProductDraftErrors = { options: {} };
  if (draft.name.trim() === "") errors.name = "상품 이름을 입력해 주세요.";
  if (nonNegativeInteger(draft.price) === undefined) {
    errors.price = "가격은 0 이상의 정수여야 합니다.";
  }
  if (draft.info.trim() === "") errors.info = "상품 설명을 입력해 주세요.";
  if (
    draft.options.length === 0 &&
    !draft.unlimitedStock &&
    nonNegativeInteger(draft.stock) === undefined
  ) {
    errors.stock = "재고는 0 이상의 정수여야 합니다.";
  }
  if (draft.options.length > 0 && draft.optionLabel.trim() === "") {
    errors.optionLabel = "옵션 묶음 이름을 입력해 주세요.";
  }
  if (
    draft.primaryImage === null ||
    (mode === "create" && draft.primaryImage.uploadId === null)
  ) {
    errors.primaryImage = "대표 이미지를 업로드해 주세요.";
  }

  const nameCounts = new Map<string, number>();
  for (const option of draft.options) {
    const name = option.name.trim();
    if (name !== "") nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  for (const option of draft.options) {
    const optionErrors: ProductDraftErrors["options"][string] = {};
    const name = option.name.trim();
    if (name === "") optionErrors.name = "옵션 이름을 입력해 주세요.";
    else if ((nameCounts.get(name) ?? 0) > 1) {
      optionErrors.name = "같은 옵션 이름을 중복할 수 없습니다.";
    }
    if (nonNegativeInteger(option.additionalPrice) === undefined) {
      optionErrors.additionalPrice = "추가 금액은 0 이상의 정수여야 합니다.";
    }
    if (
      !option.unlimitedStock &&
      nonNegativeInteger(option.stock) === undefined
    ) {
      optionErrors.stock = "재고는 0 이상의 정수여야 합니다.";
    }
    if (Object.keys(optionErrors).length > 0) {
      errors.options[option.clientId] = optionErrors;
    }
  }
  return errors;
}

export function hasProductDraftErrors(errors: ProductDraftErrors) {
  return (
    Object.entries(errors).some(
      ([key, value]) => key !== "options" && value !== undefined,
    ) || Object.keys(errors.options).length > 0
  );
}

function sameImage(
  left: ProductImageDraft | null,
  right: ProductImageDraft | null,
) {
  return left?.uploadId === right?.uploadId && left?.src === right?.src;
}

function sameImageList(left: ProductImageDraft[], right: ProductImageDraft[]) {
  return (
    left.length === right.length &&
    left.every((image, index) => sameImage(image, right[index] ?? null))
  );
}

export function productFormValue(
  draft: ProductDraft,
  baseDraft: ProductDraft,
  mode: "create" | "edit",
): ProductFormValue {
  const includePrimary =
    mode === "create" || !sameImage(draft.primaryImage, baseDraft.primaryImage);
  const includeDetails =
    mode === "create" ||
    !sameImageList(draft.detailImages, baseDraft.detailImages);
  return {
    name: draft.name.trim(),
    code: draft.code.trim() || null,
    price: Number(draft.price),
    category: draft.category,
    color: draft.color,
    pattern: draft.pattern,
    material: draft.material,
    info: draft.info.trim(),
    stock:
      draft.options.length > 0 || draft.unlimitedStock
        ? null
        : Number(draft.stock),
    optionLabel:
      draft.options.length === 0 ? null : draft.optionLabel.trim() || null,
    options: draft.options.map((option) => ({
      ...(option.id === undefined ? {} : { id: option.id }),
      name: option.name.trim(),
      additionalPrice: Number(option.additionalPrice),
      stock: option.unlimitedStock ? null : Number(option.stock),
    })),
    ...(includePrimary
      ? { imageUploadId: draft.primaryImage?.uploadId ?? "" }
      : {}),
    ...(includeDetails
      ? {
          detailImageUploadIds: draft.detailImages.flatMap((image) =>
            image.uploadId === null ? [] : [image.uploadId],
          ),
        }
      : {}),
  };
}
