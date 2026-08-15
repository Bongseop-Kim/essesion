import {
  adminCreateProductMutation,
  adminListProductsQueryKey,
} from "@essesion/api-client/query";
import { ActionButton, HStack, snackbar, VStack } from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useNavigate } from "react-router";

import { RouteHeading } from "../../shared/ui/route-heading";
import { ProductForm } from "./product-form";
import { emptyProductDraft, type ProductFormValue } from "./product-form-model";

function createBody(value: ProductFormValue) {
  return {
    name: value.name,
    code: value.code,
    price: value.price,
    category: value.category,
    color: value.color,
    pattern: value.pattern,
    material: value.material,
    info: value.info,
    stock: value.stock,
    option_label: value.optionLabel,
    options: value.options.map((option) => ({
      ...(option.id === undefined ? {} : { id: option.id }),
      name: option.name,
      additional_price: option.additionalPrice,
      stock: option.stock,
    })),
    image_upload_id: value.imageUploadId ?? "",
    detail_image_upload_ids:
      value.detailImages?.flatMap((image) =>
        "uploadId" in image ? [image.uploadId] : [],
      ) ?? [],
  };
}

export function ProductNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // 저장 성공 후 navigate가 "저장하지 않은 변경" 다이얼로그를 띄우지 않도록 차단을 건너뛴다.
  const savedRef = useRef(false);
  const mutation = useMutation({
    ...adminCreateProductMutation(),
    onSuccess: async (product) => {
      savedRef.current = true;
      snackbar("상품을 등록했습니다.");
      await queryClient.invalidateQueries({
        queryKey: adminListProductsQueryKey(),
      });
      navigate(`/products/${product.id}`, { replace: true });
    },
  });

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="상품 등록"
          description="이미지 업로드를 완료한 뒤 상품·옵션·이미지 관계를 한 번에 저장합니다."
        />
        <ActionButton variant="ghost" onClick={() => navigate("/products")}>
          목록으로
        </ActionButton>
      </HStack>
      <ProductForm
        initial={emptyProductDraft}
        resetSignal={0}
        mode="create"
        pending={mutation.isPending}
        error={mutation.error}
        blockerBypassRef={savedRef}
        onSubmit={(value) => mutation.mutate({ body: createBody(value) })}
      />
    </VStack>
  );
}
