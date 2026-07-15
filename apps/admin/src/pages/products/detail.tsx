import type { AdminProductDetailOut } from "@essesion/api-client";
import { adminGetProductOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  Grid,
  HStack,
  ImageFrame,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { formatDateTime, formatMoney } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { AdminTable } from "../../widgets/admin-table/admin-table";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_COLORS,
  PRODUCT_MATERIALS,
  PRODUCT_PATTERNS,
} from "./product-attributes";

function attributeLabel(
  attributes: readonly { value: string; label: string }[],
  value: string,
) {
  return attributes.find((item) => item.value === value)?.label ?? value;
}

function stockLabel(product: AdminProductDetailOut) {
  if (product.option_count > 0) {
    return product.option_stock_total === null
      ? "옵션별 · 무제한 포함"
      : `옵션 합계 ${product.option_stock_total.toLocaleString("ko-KR")}개`;
  }
  return product.stock === null
    ? "무제한"
    : `${product.stock.toLocaleString("ko-KR")}개`;
}

type OptionRow = NonNullable<AdminProductDetailOut["options"]>[number];

const optionColumns: readonly AdminTableColumn<OptionRow>[] = [
  {
    key: "name",
    header: "옵션 이름",
    render: (option) => option.name,
  },
  {
    key: "additional_price",
    header: "추가 금액",
    align: "end",
    render: (option) => formatMoney(option.additional_price),
  },
  {
    key: "stock",
    header: "재고",
    align: "end",
    render: (option) =>
      option.stock === null
        ? "무제한"
        : `${option.stock.toLocaleString("ko-KR")}개`,
  },
];

function ProductDetailLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="상품 상세"
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

export function ProductDetailPage() {
  const { productId = "" } = useParams();
  const navigate = useNavigate();
  const productIdNumber = Number(productId);
  const validProductId =
    Number.isSafeInteger(productIdNumber) && productIdNumber > 0;
  const query = useQuery({
    ...adminGetProductOptions({
      path: { product_id: validProductId ? productIdNumber : 0 },
    }),
    enabled: validProductId,
  });
  const product = query.data;

  if (query.isLoading) return <ProductDetailLoading />;
  if (!validProductId) {
    // ID 자체가 잘못됐으면 query가 비활성(enabled:false)이라 refetch로 회복할 수 없다.
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="상품 상세"
          description="상품과 옵션 정보를 확인합니다."
        />
        <ContentPlaceholder
          title="상품을 찾을 수 없습니다"
          description="유효하지 않은 상품 ID입니다. 목록에서 다시 선택해 주세요."
          action={
            <ActionButton onClick={() => navigate("/products")}>
              목록으로
            </ActionButton>
          }
        />
      </VStack>
    );
  }
  if (query.isError || product === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="상품 상세"
          description="상품과 옵션 정보를 확인합니다."
        />
        <ContentPlaceholder
          title="상품을 불러오지 못했습니다"
          description="상품 ID를 확인하거나 다시 시도해 주세요."
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const detailImages = product.detail_images ?? [];
  const options = product.options ?? [];

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={product.name}
          description={`${product.code ?? "상품 코드 없음"} · 마지막 수정 ${formatDateTime(product.updated_at)}`}
        />
        <HStack gap="x2" wrap>
          <ActionButton variant="ghost" onClick={() => navigate("/products")}>
            목록으로
          </ActionButton>
          <ActionButton
            variant="neutralWeak"
            onClick={() => navigate(`/products/${product.id}/edit`)}
          >
            수정
          </ActionButton>
        </HStack>
      </HStack>

      <AdminCard title="상품 정보">
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
                { label: "상품 이름", value: product.name },
                { label: "상품 코드", value: product.code ?? "없음" },
                { label: "가격", value: formatMoney(product.price) },
                { label: "재고", value: stockLabel(product) },
                {
                  label: "분류",
                  value: [
                    attributeLabel(PRODUCT_CATEGORIES, product.category),
                    attributeLabel(PRODUCT_COLORS, product.color),
                    attributeLabel(PRODUCT_PATTERNS, product.pattern),
                    attributeLabel(PRODUCT_MATERIALS, product.material),
                  ].join(" · "),
                },
                { label: "등록일", value: formatDateTime(product.created_at) },
                {
                  label: "마지막 수정",
                  value: formatDateTime(product.updated_at),
                },
              ]}
            />
          </VStack>
        </HStack>
      </AdminCard>

      <AdminCard
        title="옵션"
        description={
          options.length === 0
            ? undefined
            : `${product.option_label ?? "옵션"} ${options.length.toLocaleString("ko-KR")}개`
        }
      >
        <AdminTable
          label="상품 옵션 목록"
          columns={optionColumns}
          rows={options}
          getRowKey={(option) => option.id}
          status="success"
          emptyTitle="등록된 옵션이 없습니다"
        />
      </AdminCard>

      <AdminCard title="상품 정보 문구">
        {product.info.trim() === "" ? (
          <Text textStyle="bodySm" color="fg.neutral-muted">
            등록된 상품 정보 문구가 없습니다.
          </Text>
        ) : (
          <Text textStyle="bodySm" className="whitespace-pre-wrap">
            {product.info}
          </Text>
        )}
      </AdminCard>

      <AdminCard
        title="상세 이미지"
        description={
          detailImages.length === 0
            ? undefined
            : `${detailImages.length.toLocaleString("ko-KR")}장`
        }
      >
        {detailImages.length === 0 ? (
          <Text textStyle="bodySm" color="fg.neutral-muted">
            등록된 상세 이미지가 없습니다.
          </Text>
        ) : (
          <Grid columns={{ base: 2, md: 4 }} gap="x3">
            {detailImages.map((image, index) => (
              <Box key={image.upload_id ?? image.url}>
                <ImageFrame
                  src={image.url}
                  alt={`${product.name} 상세 이미지 ${index + 1}`}
                  ratio={1}
                  fit="cover"
                  stroke
                />
              </Box>
            ))}
          </Grid>
        )}
      </AdminCard>
    </VStack>
  );
}
