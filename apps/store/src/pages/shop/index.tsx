import type { ListProductsData } from "@essesion/api-client";
import { listProductsInfiniteOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  Grid,
  HStack,
  ListPicker,
  ProgressCircle,
  ScrollFog,
  Text,
  useBreakpoint,
  VStack,
} from "@essesion/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";

import { ProductCard, ProductCardSkeleton } from "@/entities/product";
import {
  offsetPageParam,
  useInfiniteScrollSentinel,
} from "@/shared/lib/infinite-scroll";
import { PageMeta } from "@/shared/seo/page-meta";
import { ContentLayout } from "@/shared/ui/content-layout";
import {
  CATEGORY_OPTIONS,
  COLOR_OPTIONS,
  type FilterValue,
  MATERIAL_OPTIONS,
  PAGE_SIZE,
  PATTERN_OPTIONS,
  type ProductCategory,
  type ProductColor,
  type ProductMaterial,
  type ProductPattern,
  type ProductSort,
  SORT_OPTIONS,
  selectedFilter,
} from "./constants";

type ProductQuery = NonNullable<ListProductsData["query"]>;
const FILTER_PICKER_SLOT_WIDTH = "8.5rem";
const PAGE_REQUEST_SIZE = PAGE_SIZE + 1;

export function ShopPage() {
  const bp = useBreakpoint();
  const isMobile = bp === "base" || bp === "sm";
  const [category, setCategory] = useState<FilterValue<ProductCategory>>("all");
  const [color, setColor] = useState<FilterValue<ProductColor>>("all");
  const [pattern, setPattern] = useState<FilterValue<ProductPattern>>("all");
  const [material, setMaterial] = useState<FilterValue<ProductMaterial>>("all");
  const [sort, setSort] = useState<ProductSort>("latest");
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = useMemo<ProductQuery>(
    () => ({
      category: selectedFilter(category),
      color: selectedFilter(color),
      pattern: selectedFilter(pattern),
      material: selectedFilter(material),
      sort,
      limit: PAGE_REQUEST_SIZE,
    }),
    [category, color, material, pattern, sort],
  );

  const productsQuery = useInfiniteQuery({
    ...listProductsInfiniteOptions({ query }),
    initialPageParam: 0,
    getNextPageParam: offsetPageParam(PAGE_SIZE),
  });
  const products =
    productsQuery.data?.pages.flatMap((page) => page.slice(0, PAGE_SIZE)) ?? [];
  const showInitialLoading = productsQuery.isPending && products.length === 0;
  const hasFilter =
    category !== "all" ||
    color !== "all" ||
    pattern !== "all" ||
    material !== "all";

  useInfiniteScrollSentinel(sentinelRef, productsQuery, isMobile);

  const resetFilters = () => {
    setCategory("all");
    setColor("all");
    setPattern("all");
    setMaterial("all");
  };

  return (
    <ContentLayout>
      <PageMeta
        title="스토어 | 영선산업"
        description="ESSE SION의 3폴드·스폴더라토·니트·보타이 넥타이 컬렉션을 둘러보세요."
        path="/shop"
      />
      <VStack gap="x6">
        <VStack gap="x3">
          <Text as="h1" textStyle="title1">
            스토어
          </Text>
          <Text as="p" textStyle="body" color="fg.neutral-muted">
            ESSE SION의 넥타이 컬렉션을 둘러보세요.
          </Text>
        </VStack>

        <VStack gap="x4">
          <HStack gap="x3" wrap="nowrap">
            <Box flex={1} minWidth={0}>
              <ScrollFog direction="horizontal">
                <HStack gap="x2" wrap="nowrap">
                  <FilterPickerSlot>
                    <ListPicker
                      title="카테고리"
                      value={category}
                      onValueChange={(value) =>
                        setCategory(value as FilterValue<ProductCategory>)
                      }
                      options={CATEGORY_OPTIONS}
                      placeholder="카테고리"
                    />
                  </FilterPickerSlot>
                  <FilterPickerSlot>
                    <ListPicker
                      title="색상"
                      value={color}
                      onValueChange={(value) =>
                        setColor(value as FilterValue<ProductColor>)
                      }
                      options={COLOR_OPTIONS}
                      placeholder="색상"
                    />
                  </FilterPickerSlot>
                  <FilterPickerSlot>
                    <ListPicker
                      title="패턴"
                      value={pattern}
                      onValueChange={(value) =>
                        setPattern(value as FilterValue<ProductPattern>)
                      }
                      options={PATTERN_OPTIONS}
                      placeholder="패턴"
                    />
                  </FilterPickerSlot>
                  <FilterPickerSlot>
                    <ListPicker
                      title="소재"
                      value={material}
                      onValueChange={(value) =>
                        setMaterial(value as FilterValue<ProductMaterial>)
                      }
                      options={MATERIAL_OPTIONS}
                      placeholder="소재"
                    />
                  </FilterPickerSlot>
                </HStack>
              </ScrollFog>
            </Box>
            <ActionButton
              type="button"
              variant="ghost"
              size="small"
              aria-label="필터 초기화"
              disabled={!hasFilter}
              onClick={resetFilters}
            >
              초기화
            </ActionButton>
          </HStack>

          <HStack justify="space-between" gap="x3" wrap>
            <Text textStyle="bodySm" color="fg.neutral-muted">
              {showInitialLoading
                ? "상품을 불러오는 중"
                : `${products.length}개 표시`}
            </Text>
            <HStack gap="x2" wrap>
              <ListPicker
                title="정렬"
                value={sort}
                onValueChange={(value) => setSort(value as ProductSort)}
                options={SORT_OPTIONS}
                placeholder="정렬"
              />
            </HStack>
          </HStack>
        </VStack>

        {productsQuery.isError ? (
          <ContentPlaceholder
            title="상품을 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
          />
        ) : products.length === 0 && !showInitialLoading ? (
          <ContentPlaceholder title="조건에 맞는 상품이 없습니다" />
        ) : (
          <Grid
            columns={{ base: 2, md: 3, lg: 4 }}
            gap={{ base: "x3", md: "x5" }}
          >
            {showInitialLoading
              ? Array.from({ length: PAGE_SIZE }, (_, i) => (
                  <ProductCardSkeleton key={i} />
                ))
              : products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
          </Grid>
        )}

        {!isMobile && productsQuery.hasNextPage && products.length > 0 ? (
          <HStack justify="center" pt="x2">
            <ActionButton
              type="button"
              variant="neutralOutline"
              loading={productsQuery.isFetchingNextPage}
              onClick={() => productsQuery.fetchNextPage()}
            >
              더 보기
            </ActionButton>
          </HStack>
        ) : null}

        {isMobile && productsQuery.hasNextPage ? (
          <Box ref={sentinelRef} py="x4">
            {productsQuery.isFetchingNextPage ? (
              <HStack justify="center">
                <ProgressCircle />
              </HStack>
            ) : null}
          </Box>
        ) : null}
      </VStack>
    </ContentLayout>
  );
}

function FilterPickerSlot({ children }: { children: ReactNode }) {
  return (
    <Box
      flex={`0 0 ${FILTER_PICKER_SLOT_WIDTH}`}
      width={FILTER_PICKER_SLOT_WIDTH}
      minWidth={FILTER_PICKER_SLOT_WIDTH}
      maxWidth={FILTER_PICKER_SLOT_WIDTH}
    >
      {children}
    </Box>
  );
}
