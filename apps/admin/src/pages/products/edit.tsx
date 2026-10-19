import type { AdminProductDetailOut } from "@essesion/api-client";
import {
  adminGetProductOptions,
  adminGetProductQueryKey,
  adminListProductsQueryKey,
  adminUpdateProductMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  ContentPlaceholder,
  HStack,
  ImageFrame,
  Skeleton,
  snackbar,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { formatDateTime, formatMoney } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { ProductForm } from "./product-form";
import {
  type ProductFormValue,
  productDraftFromDetail,
} from "./product-form-model";

function ProductEditLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="상품 수정"
        description="상품과 옵션 정보를 불러오고 있습니다."
      />
      <AdminCard title="상품 정보">
        <VStack gap="x3" alignItems="stretch">
          <Skeleton width="60%" height={24} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="80%" height={20} />
        </VStack>
      </AdminCard>
    </VStack>
  );
}

function updateBody(value: ProductFormValue, revision: string) {
  return {
    expected_updated_at: revision,
    name: value.name,
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
    ...(value.imageUploadId === undefined
      ? {}
      : { image_upload_id: value.imageUploadId }),
    ...(value.detailImages === undefined
      ? {}
      : {
          detail_images: value.detailImages.map((image) => ({
            upload_id: image.uploadId,
          })),
        }),
  };
}

function ServerComparison({ product }: { product: AdminProductDetailOut }) {
  return (
    <AdminCard
      title="저장된 최신 내용"
      description={`마지막 저장 ${formatDateTime(product.updated_at)}`}
    >
      <HStack gap="x5" align="flex-start" wrap>
        <VStack width={160}>
          <ImageFrame
            src={product.image}
            alt={`${product.name} 대표 이미지`}
            ratio={1}
            fit="cover"
            stroke
          />
        </VStack>
        <VStack flex={1} minWidth={260} alignItems="stretch">
          <DetailList
            items={[
              { label: "상품명", value: product.name },
              { label: "가격", value: formatMoney(product.price) },
              {
                label: "재고",
                value:
                  product.option_count > 0
                    ? `옵션 ${product.option_count.toLocaleString("ko-KR")}개`
                    : product.stock === null
                      ? "무제한"
                      : `${product.stock.toLocaleString("ko-KR")}개`,
              },
              {
                label: "카테고리",
                value: `${product.category} · ${product.color} · ${product.pattern} · ${product.material}`,
              },
              {
                label: "마지막 수정",
                value: formatDateTime(product.updated_at),
              },
            ]}
          />
        </VStack>
      </HStack>
    </AdminCard>
  );
}

export function ProductEditPage() {
  const { productId = "" } = useParams();
  return <ProductEditPageContent key={productId} productId={productId} />;
}

function ProductEditPageContent({ productId }: { productId: string }) {
  const productIdNumber = Number(productId);
  const validProductId =
    Number.isSafeInteger(productIdNumber) && productIdNumber > 0;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [resetSignal, setResetSignal] = useState(0);
  const [comparison, setComparison] = useState<AdminProductDetailOut>();
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const queryOptions = adminGetProductOptions({
    path: { product_id: validProductId ? productIdNumber : 0 },
  });
  const query = useQuery({ ...queryOptions, enabled: validProductId });
  const mutation = useMutation({
    ...adminUpdateProductMutation(),
    onSuccess: async (product) => {
      snackbar("상품 정보를 저장했습니다.");
      queryClient.setQueryData(
        adminGetProductQueryKey({ path: { product_id: productIdNumber } }),
        product,
      );
      await queryClient.invalidateQueries({
        queryKey: adminListProductsQueryKey(),
      });
      setComparison(undefined);
      setResetSignal((current) => current + 1);
    },
  });
  const product = query.data;
  const initial = useMemo(
    () => (product === undefined ? undefined : productDraftFromDetail(product)),
    [product],
  );

  if (query.isLoading) return <ProductEditLoading />;
  if (
    !validProductId ||
    query.isError ||
    product === undefined ||
    initial === undefined
  ) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading title="상품 수정" />
        <ContentPlaceholder
          title="상품을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const compareServer = async () => {
    const result = await query.refetch();
    if (result.data !== undefined) setComparison(result.data);
  };
  const resetFromServer = async () => {
    const result = await query.refetch();
    if (result.data === undefined) return;
    mutation.reset();
    setComparison(undefined);
    setResetSignal((current) => current + 1);
  };

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={product.name}
          description={`${product.code ?? "상품 코드 없음"} · 마지막 수정 ${formatDateTime(product.updated_at)}`}
        />
        <ActionButton
          variant="ghost"
          onClick={() => navigate(`/products/${product.id}`)}
        >
          상세로
        </ActionButton>
      </HStack>

      <ProductForm
        initial={initial}
        revision={product.updated_at}
        resetSignal={resetSignal}
        mode="edit"
        pending={mutation.isPending}
        error={mutation.error}
        errorAction={
          <HStack gap="x2" wrap>
            <ActionButton
              variant="neutralOutline"
              loading={query.isFetching}
              onClick={() => void compareServer()}
            >
              최신 내용과 비교
            </ActionButton>
            <ActionButton
              variant="ghost"
              onClick={() => setReloadConfirmOpen(true)}
            >
              최신 내용으로 되돌리기
            </ActionButton>
          </HStack>
        }
        onSubmit={(value, revision) => {
          if (revision === undefined) return;
          mutation.mutate({
            path: { product_id: product.id },
            body: updateBody(value, revision),
          });
        }}
      />

      {comparison !== undefined && <ServerComparison product={comparison} />}

      <AlertDialog
        open={reloadConfirmOpen}
        onOpenChange={setReloadConfirmOpen}
        title="입력한 내용을 지우고 최신 내용으로 되돌릴까요?"
        description="입력한 내용은 저장되지 않습니다."
        primaryActionProps={{
          children: "되돌리기",
          variant: "criticalSolid",
          onClick: () => void resetFromServer(),
        }}
        secondaryActionProps={{ children: "계속 작성" }}
      />
    </VStack>
  );
}
