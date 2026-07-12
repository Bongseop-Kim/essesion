import type { AdminProductSummaryOut } from "@essesion/api-client";
import { adminListProductsOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  HStack,
  ImageFrame,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { formatDateTime, formatMoney } from "../../shared/lib/format";
import { parseAdminListQuery } from "../../shared/lib/url-query";
import { AdminCard } from "../../shared/ui/admin-card";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";
import { Pagination } from "../../widgets/admin-table/pagination";

const PRODUCT_SORTS = [
  "created_at",
  "updated_at",
  "name",
  "price",
  "stock",
] as const;
const CATEGORIES = ["3fold", "sfolderato", "knit", "bowtie"] as const;
const COLORS = [
  "black",
  "navy",
  "gray",
  "wine",
  "blue",
  "brown",
  "beige",
  "silver",
] as const;
const PATTERNS = ["solid", "stripe", "dot", "check", "paisley"] as const;
const MATERIALS = ["silk", "cotton", "polyester", "wool"] as const;

type ProductSort = (typeof PRODUCT_SORTS)[number];
type ProductCategory = (typeof CATEGORIES)[number];
type ProductColor = (typeof COLORS)[number];
type ProductPattern = (typeof PATTERNS)[number];
type ProductMaterial = (typeof MATERIALS)[number];

const categoryLabels: Record<ProductCategory, string> = {
  "3fold": "쓰리폴드",
  sfolderato: "스폴데라토",
  knit: "니트",
  bowtie: "보타이",
};
const colorLabels: Record<ProductColor, string> = {
  black: "블랙",
  navy: "네이비",
  gray: "그레이",
  wine: "와인",
  blue: "블루",
  brown: "브라운",
  beige: "베이지",
  silver: "실버",
};
const patternLabels: Record<ProductPattern, string> = {
  solid: "솔리드",
  stripe: "스트라이프",
  dot: "도트",
  check: "체크",
  paisley: "페이즐리",
};
const materialLabels: Record<ProductMaterial, string> = {
  silk: "실크",
  cotton: "코튼",
  polyester: "폴리에스터",
  wool: "울",
};

function enumParam<Value extends string>(
  params: URLSearchParams,
  key: string,
  values: readonly Value[],
): Value | undefined {
  const value = params.get(key);
  return value !== null && values.includes(value as Value)
    ? (value as Value)
    : undefined;
}

function stockLabel(product: AdminProductSummaryOut) {
  if (product.option_count > 0) {
    return product.option_stock_total === null
      ? "옵션별 · 무제한 포함"
      : `옵션 합계 ${product.option_stock_total.toLocaleString("ko-KR")}개`;
  }
  return product.stock === null
    ? "무제한"
    : `${product.stock.toLocaleString("ko-KR")}개`;
}

const columns: readonly AdminTableColumn<AdminProductSummaryOut>[] = [
  {
    key: "name",
    header: "상품",
    sortable: true,
    render: (product) => (
      <HStack gap="x3" align="center">
        <Box width={56} flex="none">
          <ImageFrame src={product.image} alt="" ratio={1} fit="cover" stroke />
        </Box>
        <VStack gap="x0_5" minWidth={0}>
          <Link to={`/products/${product.id}/edit`}>{product.name}</Link>
          <Text textStyle="caption" color="fg.neutral-muted">
            {product.code ?? "상품 코드 없음"}
          </Text>
        </VStack>
      </HStack>
    ),
  },
  {
    key: "category",
    header: "분류",
    visibility: "medium",
    render: (product) =>
      categoryLabels[product.category as ProductCategory] ?? product.category,
  },
  {
    key: "price",
    header: "가격",
    sortable: true,
    align: "end",
    render: (product) => formatMoney(product.price),
  },
  {
    key: "stock",
    header: "재고",
    sortable: true,
    align: "end",
    render: stockLabel,
  },
  {
    key: "options",
    header: "옵션",
    visibility: "large",
    render: (product) =>
      product.option_count === 0
        ? "없음"
        : `${product.option_label ?? "옵션"} ${product.option_count.toLocaleString("ko-KR")}개`,
  },
  {
    key: "updated_at",
    header: "수정일",
    sortable: true,
    visibility: "large",
    render: (product) => formatDateTime(product.updated_at),
  },
];

export function ProductsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const parsed = parseAdminListQuery(params, {
    allowedSorts: PRODUCT_SORTS,
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const [searchInput, setSearchInput] = useState(params.get("q") ?? "");
  const category = enumParam(params, "category", CATEGORIES);
  const color = enumParam(params, "color", COLORS);
  const pattern = enumParam(params, "pattern", PATTERNS);
  const material = enumParam(params, "material", MATERIALS);
  const search = (params.get("q") ?? "").trim();
  const sort = (parsed.sort ?? "created_at") as ProductSort;

  const query = useQuery({
    ...adminListProductsOptions({
      query: {
        category,
        color,
        pattern,
        material,
        q: search.length >= 2 ? search : undefined,
        sort,
        direction: parsed.direction,
        limit: parsed.limit,
        offset: (parsed.page - 1) * parsed.limit,
      },
    }),
    placeholderData: keepPreviousData,
  });

  const replaceParams = (changes: Record<string, string | undefined>) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (
            value === undefined ||
            value === "" ||
            (key === "page" && value === "1") ||
            (key === "limit" && value === "20")
          ) {
            next.delete(key);
          } else {
            next.set(key, value);
          }
        }
        return next;
      },
      { replace: true },
    );
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    if (value !== "" && value.length < 2) return;
    replaceParams({ q: value || undefined, page: undefined });
  };

  const totalPages = Math.max(
    1,
    Math.ceil((query.data?.total ?? 0) / parsed.limit),
  );

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="상품 관리"
          description="상품과 옵션의 가격·재고를 서버 필터와 페이지 단위로 관리합니다."
        />
        <ActionButton onClick={() => navigate("/products/new")}>
          상품 등록
        </ActionButton>
      </HStack>

      <AdminCard title="검색·필터">
        <VStack gap="x4" alignItems="stretch">
          <HStack
            as="form"
            gap="x2"
            align="flex-end"
            wrap
            onSubmit={submitSearch}
          >
            <TextField
              label="상품명·상품 코드 검색"
              description="2자 이상 입력해 주세요. 상품 검색어는 URL에서 복구됩니다."
              value={searchInput}
              minLength={2}
              maxLength={100}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
            />
            <ActionButton
              type="submit"
              variant="neutralOutline"
              disabled={
                searchInput.trim() !== "" && searchInput.trim().length < 2
              }
            >
              검색
            </ActionButton>
            {search !== "" && (
              <ActionButton
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchInput("");
                  replaceParams({ q: undefined, page: undefined });
                }}
              >
                검색 초기화
              </ActionButton>
            )}
          </HStack>

          <HStack gap="x3" align="flex-end" wrap>
            <FilterSelect
              label="카테고리"
              value={category ?? "all"}
              options={[
                { value: "all", label: "전체" },
                ...CATEGORIES.map((value) => ({
                  value,
                  label: categoryLabels[value],
                })),
              ]}
              onChange={(event) =>
                replaceParams({
                  category:
                    event.currentTarget.value === "all"
                      ? undefined
                      : event.currentTarget.value,
                  page: undefined,
                })
              }
            />
            <FilterSelect
              label="색상"
              value={color ?? "all"}
              options={[
                { value: "all", label: "전체" },
                ...COLORS.map((value) => ({
                  value,
                  label: colorLabels[value],
                })),
              ]}
              onChange={(event) =>
                replaceParams({
                  color:
                    event.currentTarget.value === "all"
                      ? undefined
                      : event.currentTarget.value,
                  page: undefined,
                })
              }
            />
            <FilterSelect
              label="패턴"
              value={pattern ?? "all"}
              options={[
                { value: "all", label: "전체" },
                ...PATTERNS.map((value) => ({
                  value,
                  label: patternLabels[value],
                })),
              ]}
              onChange={(event) =>
                replaceParams({
                  pattern:
                    event.currentTarget.value === "all"
                      ? undefined
                      : event.currentTarget.value,
                  page: undefined,
                })
              }
            />
            <FilterSelect
              label="소재"
              value={material ?? "all"}
              options={[
                { value: "all", label: "전체" },
                ...MATERIALS.map((value) => ({
                  value,
                  label: materialLabels[value],
                })),
              ]}
              onChange={(event) =>
                replaceParams({
                  material:
                    event.currentTarget.value === "all"
                      ? undefined
                      : event.currentTarget.value,
                  page: undefined,
                })
              }
            />
            <FilterSelect
              label="페이지당 표시"
              value={String(parsed.limit)}
              options={[
                { value: "20", label: "20개" },
                { value: "50", label: "50개" },
                { value: "100", label: "100개" },
              ]}
              onChange={(event) =>
                replaceParams({
                  limit: event.currentTarget.value,
                  page: undefined,
                })
              }
            />
          </HStack>
        </VStack>
      </AdminCard>

      <AdminCard
        title="상품 목록"
        description={`총 ${query.data?.total ?? 0}개`}
        action={
          <ActionButton
            variant="ghost"
            size="small"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            새로고침
          </ActionButton>
        }
      >
        <VStack gap="x4" alignItems="stretch">
          <AdminTable
            label="상품 목록"
            columns={columns}
            rows={query.data?.items}
            getRowKey={(product) => String(product.id)}
            status={
              query.isLoading ? "loading" : query.isError ? "error" : "success"
            }
            total={query.data?.total}
            sort={{ key: sort, direction: parsed.direction }}
            onSort={({ key, direction }) =>
              replaceParams({ sort: key, direction, page: undefined })
            }
            onRetry={() => void query.refetch()}
            emptyTitle="조건에 맞는 상품이 없습니다"
          />
          <Pagination
            page={Math.min(parsed.page, totalPages)}
            totalPages={totalPages}
            onPageChange={(page) =>
              replaceParams({ page: page === 1 ? undefined : String(page) })
            }
            label="상품 목록 페이지"
          />
        </VStack>
      </AdminCard>
    </VStack>
  );
}
