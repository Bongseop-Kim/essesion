import type { ListReviewsData } from "@essesion/api-client";
import { listReviewsInfiniteOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  HStack,
  Rating,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useInfiniteQuery } from "@tanstack/react-query";

import { dateMedium } from "@/shared/lib/format";

const PAGE_SIZE = 20;

type ReviewListSectionProps = {
  productId?: number;
  orderType?: "repair" | "custom" | "sample";
};

export function ReviewListSection({
  productId,
  orderType,
}: ReviewListSectionProps) {
  const query: NonNullable<ListReviewsData["query"]> = {
    product_id: productId,
    order_type: orderType,
    limit: PAGE_SIZE,
  };
  const reviewsQuery = useInfiniteQuery({
    ...listReviewsInfiniteOptions({ query }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.items.length;
      return next < lastPage.total ? next : undefined;
    },
  });
  const reviews = reviewsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = reviewsQuery.data?.pages[0];

  if (reviewsQuery.isPending) {
    return (
      <VStack gap="x3" alignItems="stretch" aria-busy="true">
        <Skeleton width="45%" height={28} />
        <Skeleton width="100%" height={112} />
        <Skeleton width="100%" height={112} />
      </VStack>
    );
  }

  if (reviewsQuery.isError || !summary) {
    return (
      <ContentPlaceholder
        title="후기를 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        action={
          <ActionButton
            type="button"
            variant="neutralOutline"
            onClick={() => void reviewsQuery.refetch()}
          >
            다시 시도
          </ActionButton>
        }
      />
    );
  }

  if (summary.total === 0) {
    return (
      <ContentPlaceholder
        title="아직 등록된 후기가 없습니다"
        description="서비스를 이용한 고객의 첫 후기를 기다리고 있어요."
      />
    );
  }

  return (
    <VStack gap="x5" alignItems="stretch">
      <HStack gap="x3" wrap>
        <Rating value={summary.avg_rating} />
        <Text textStyle="label">{summary.avg_rating.toFixed(1)}</Text>
        <Text textStyle="bodySm" color="fg.neutral-muted">
          후기 {summary.total}개
        </Text>
      </HStack>

      <VStack gap="x3" alignItems="stretch">
        {reviews.map((review) => (
          <Box
            key={review.id}
            borderWidth={1}
            borderColor="stroke.neutral-weak"
            borderRadius="r3"
            p="x4"
          >
            <VStack gap="x3" alignItems="stretch">
              <HStack justify="space-between" gap="x3" wrap>
                <HStack gap="x2" wrap>
                  <Text textStyle="labelSm">{review.author_name}</Text>
                  <Rating
                    value={review.rating}
                    aria-label={`${review.author_name}님의 별점 ${review.rating}점`}
                  />
                </HStack>
                <Text textStyle="caption" color="fg.neutral-muted">
                  {dateMedium.format(new Date(review.created_at))}
                </Text>
              </HStack>
              <Text className="whitespace-pre-wrap break-words">
                {review.content}
              </Text>
            </VStack>
          </Box>
        ))}
      </VStack>

      {reviewsQuery.hasNextPage ? (
        <ActionButton
          type="button"
          variant="neutralOutline"
          loading={reviewsQuery.isFetchingNextPage}
          onClick={() => void reviewsQuery.fetchNextPage()}
        >
          더보기
        </ActionButton>
      ) : null}
    </VStack>
  );
}
