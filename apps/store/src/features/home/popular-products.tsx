import { listProductsOptions } from "@essesion/api-client/query";
import { ContentPlaceholder, Grid } from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";

import { ProductCard, ProductCardSkeleton } from "@/entities/product";
import { Section, SectionHeader } from "./section";

/** 인기 상품 4개 — 서버 정렬(sort=popular). 원본 "지금 가장 많이 찾는 넥타이". */
export function PopularProducts() {
  const { data: products = [], isLoading } = useQuery(
    listProductsOptions({ query: { sort: "popular", limit: 4 } }),
  );

  return (
    <Section>
      <SectionHeader
        title="지금 가장 많이 찾는 넥타이"
        more="전체 보기"
        href="/shop"
      />
      {!isLoading && products.length === 0 ? (
        <ContentPlaceholder title="상품을 불러오지 못했습니다" />
      ) : (
        <Grid
          columns={{ base: 2, md: 4 }}
          gap={{ base: "x2", md: "x4" }}
          pt="x1"
        >
          {isLoading
            ? Array.from({ length: 4 }, (_, i) => (
                <ProductCardSkeleton key={i} />
              ))
            : products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
        </Grid>
      )}
    </Section>
  );
}
