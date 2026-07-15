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
import { useAdminListPageCorrection } from "../../shared/lib/use-admin-list-url-state";
import { AppliedFilterBar } from "../../shared/ui/applied-filter-bar";
import { CompactFilterToolbar } from "../../shared/ui/compact-filter-toolbar";
import { DateRangeFilters } from "../../shared/ui/date-range-filters";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_COLORS,
  PRODUCT_MATERIALS,
  PRODUCT_PATTERNS,
  type ProductCategory,
  type ProductColor,
  type ProductMaterial,
  type ProductPattern,
} from "./product-attributes";

const PRODUCT_SORTS = [
  "created_at",
  "updated_at",
  "name",
  "price",
  "stock",
] as const;
const CATEGORIES = PRODUCT_CATEGORIES.map(({ value }) => value);
const COLORS = PRODUCT_COLORS.map(({ value }) => value);
const PATTERNS = PRODUCT_PATTERNS.map(({ value }) => value);
const MATERIALS = PRODUCT_MATERIALS.map(({ value }) => value);

type ProductSort = (typeof PRODUCT_SORTS)[number];

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
          <Link to={`/products/${product.id}`}>{product.name}</Link>
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
      PRODUCT_CATEGORIES.find(
        ({ value }) => value === (product.category as ProductCategory),
      )?.label ?? product.category,
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
  const [draftCategory, setDraftCategory] = useState<
    ProductCategory | undefined
  >(category);
  const [draftColor, setDraftColor] = useState<ProductColor | undefined>(color);
  const [draftPattern, setDraftPattern] = useState<ProductPattern | undefined>(
    pattern,
  );
  const [draftMaterial, setDraftMaterial] = useState<
    ProductMaterial | undefined
  >(material);
  const [draftFrom, setDraftFrom] = useState(parsed.from);
  const [draftTo, setDraftTo] = useState(parsed.to);

  const query = useQuery({
    ...adminListProductsOptions({
      query: {
        category,
        color,
        pattern,
        material,
        q: search.length >= 2 ? search : undefined,
        start_date: parsed.from,
        end_date: parsed.to,
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
  useAdminListPageCorrection({
    page: parsed.page,
    limit: parsed.limit,
    total: query.data?.total,
    ready: query.isSuccess && !query.isPlaceholderData,
    replaceQuery: ({ page }) =>
      replaceParams({ page: page === undefined ? undefined : String(page) }),
  });

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

      <PaginatedAdminTableCard
        title="상품 목록"
        label="상품 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(product) => String(product.id)}
        onRowClick={(product) => navigate(`/products/${product.id}`)}
        status={
          query.isLoading || query.isPlaceholderData
            ? "loading"
            : query.isError
              ? "error"
              : "success"
        }
        total={query.data?.total}
        limit={parsed.limit}
        pageSizeOptions={[20, 50, 100]}
        onPageSizeChange={(pageSize) =>
          replaceParams({ limit: String(pageSize), page: undefined })
        }
        sort={{ key: sort, direction: parsed.direction }}
        onSort={({ key, direction }) =>
          replaceParams({ sort: key, direction, page: undefined })
        }
        refreshing={query.isFetching}
        onRefresh={() => void query.refetch()}
        emptyTitle="조건에 맞는 상품이 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) =>
          replaceParams({ page: page === 1 ? undefined : String(page) })
        }
        paginationLabel="상품 목록 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <HStack
                  as="form"
                  width="full"
                  gap="x2"
                  align="flex-end"
                  wrap
                  onSubmit={submitSearch}
                >
                  <Box flex={1} minWidth={0}>
                    <TextField
                      label="상품명·상품 코드 검색"
                      placeholder="2자 이상 입력"
                      value={searchInput}
                      minLength={2}
                      maxLength={100}
                      onChange={(event) =>
                        setSearchInput(event.currentTarget.value)
                      }
                    />
                  </Box>
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
              }
              secondaryFilters={
                <VStack gap="x4" alignItems="stretch">
                  <FilterSelect
                    label="카테고리"
                    presentation="inline"
                    value={draftCategory ?? "all"}
                    options={[
                      { value: "all", label: "전체" },
                      ...PRODUCT_CATEGORIES,
                    ]}
                    onValueChange={(value) =>
                      setDraftCategory(
                        value === "all"
                          ? undefined
                          : (value as ProductCategory),
                      )
                    }
                  />
                  <FilterSelect
                    label="색상"
                    presentation="inline"
                    value={draftColor ?? "all"}
                    options={[
                      { value: "all", label: "전체" },
                      ...PRODUCT_COLORS,
                    ]}
                    onValueChange={(value) =>
                      setDraftColor(
                        value === "all" ? undefined : (value as ProductColor),
                      )
                    }
                  />
                  <FilterSelect
                    label="패턴"
                    presentation="inline"
                    value={draftPattern ?? "all"}
                    options={[
                      { value: "all", label: "전체" },
                      ...PRODUCT_PATTERNS,
                    ]}
                    onValueChange={(value) =>
                      setDraftPattern(
                        value === "all" ? undefined : (value as ProductPattern),
                      )
                    }
                  />
                  <FilterSelect
                    label="소재"
                    presentation="inline"
                    value={draftMaterial ?? "all"}
                    options={[
                      { value: "all", label: "전체" },
                      ...PRODUCT_MATERIALS,
                    ]}
                    onValueChange={(value) =>
                      setDraftMaterial(
                        value === "all"
                          ? undefined
                          : (value as ProductMaterial),
                      )
                    }
                  />
                  <DateRangeFilters
                    presentation="inline"
                    from={draftFrom}
                    to={draftTo}
                    onFromChange={setDraftFrom}
                    onToChange={setDraftTo}
                  />
                </VStack>
              }
              secondaryFilterCount={
                Number(category !== undefined) +
                Number(color !== undefined) +
                Number(pattern !== undefined) +
                Number(material !== undefined) +
                Number(parsed.from !== undefined) +
                Number(parsed.to !== undefined)
              }
              secondaryTitle="상품 상세 필터"
              secondaryDescription="카테고리·색상·패턴·소재·등록일을 한 번에 적용합니다."
              onOpenSecondaryFilters={() => {
                setDraftCategory(category);
                setDraftColor(color);
                setDraftPattern(pattern);
                setDraftMaterial(material);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onApplySecondaryFilters={() => {
                replaceParams({
                  category: draftCategory,
                  color: draftColor,
                  pattern: draftPattern,
                  material: draftMaterial,
                  from: draftFrom,
                  to: draftTo,
                  page: undefined,
                });
              }}
              onCancelSecondaryFilters={() => {
                setDraftCategory(category);
                setDraftColor(color);
                setDraftPattern(pattern);
                setDraftMaterial(material);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
            />
            <AppliedFilterBar
              filters={[
                search.length >= 2 && {
                  key: "search",
                  label: `검색: ${search}`,
                  onRemove: () => {
                    setSearchInput("");
                    replaceParams({ q: undefined, page: undefined });
                  },
                },
                category !== undefined && {
                  key: "category",
                  label: `카테고리: ${PRODUCT_CATEGORIES.find((item) => item.value === category)?.label ?? category}`,
                  onRemove: () =>
                    replaceParams({ category: undefined, page: undefined }),
                },
                color !== undefined && {
                  key: "color",
                  label: `색상: ${PRODUCT_COLORS.find((item) => item.value === color)?.label ?? color}`,
                  onRemove: () =>
                    replaceParams({ color: undefined, page: undefined }),
                },
                pattern !== undefined && {
                  key: "pattern",
                  label: `패턴: ${PRODUCT_PATTERNS.find((item) => item.value === pattern)?.label ?? pattern}`,
                  onRemove: () =>
                    replaceParams({ pattern: undefined, page: undefined }),
                },
                material !== undefined && {
                  key: "material",
                  label: `소재: ${PRODUCT_MATERIALS.find((item) => item.value === material)?.label ?? material}`,
                  onRemove: () =>
                    replaceParams({ material: undefined, page: undefined }),
                },
                parsed.from !== undefined && {
                  key: "from",
                  label: `등록 시작일: ${parsed.from}`,
                  onRemove: () =>
                    replaceParams({ from: undefined, page: undefined }),
                },
                parsed.to !== undefined && {
                  key: "to",
                  label: `등록 종료일: ${parsed.to}`,
                  onRemove: () =>
                    replaceParams({ to: undefined, page: undefined }),
                },
              ]}
              onReset={() => {
                setSearchInput("");
                replaceParams({
                  q: undefined,
                  category: undefined,
                  color: undefined,
                  pattern: undefined,
                  material: undefined,
                  from: undefined,
                  to: undefined,
                  page: undefined,
                  limit: undefined,
                  sort: undefined,
                  direction: undefined,
                });
              }}
            />
          </VStack>
        }
      />
    </VStack>
  );
}
