import type { ReviewOut } from "@essesion/api-client";
import {
  deleteAdminReviewMutation,
  listAdminReviewsOptions,
  listAdminReviewsQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Rating,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import {
  parseAdminListQuery,
  serializeAdminListQuery,
} from "../../shared/lib/url-query";
import { useAdminListPageCorrection } from "../../shared/lib/use-admin-list-url-state";
import { AppliedFilterBar } from "../../shared/ui/applied-filter-bar";
import { CompactFilterToolbar } from "../../shared/ui/compact-filter-toolbar";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

const ORDER_TYPES = ["all", "sale", "repair", "custom", "sample"] as const;
const RATINGS = ["all", "1", "2", "3", "4", "5"] as const;
type OrderType = (typeof ORDER_TYPES)[number];
type RatingFilter = (typeof RATINGS)[number];

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  all: "전체",
  sale: "상품",
  repair: "수선",
  custom: "주문 제작",
  sample: "샘플 제작",
};

export function ReviewsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const parsed = parseAdminListQuery(params, {
    allowedStatuses: RATINGS,
    allowedTypes: ORDER_TYPES,
    defaultDirection: "desc",
  });
  const orderType = (parsed.type ?? "all") as OrderType;
  const rating = (parsed.status ?? "all") as RatingFilter;
  const [draftOrderType, setDraftOrderType] = useState(orderType);
  const [draftRating, setDraftRating] = useState(rating);
  const [deleteTarget, setDeleteTarget] = useState<ReviewOut | null>(null);
  const offset = (parsed.page - 1) * parsed.limit;
  const query = useQuery({
    ...listAdminReviewsOptions({
      query: {
        order_type: orderType === "all" ? undefined : orderType,
        rating: rating === "all" ? undefined : Number(rating),
        limit: parsed.limit,
        offset,
      },
    }),
    placeholderData: keepPreviousData,
  });
  const deleteReview = useMutation({
    ...deleteAdminReviewMutation(),
    onSuccess: async () => {
      setDeleteTarget(null);
      snackbar("후기를 삭제했습니다.");
      await queryClient.invalidateQueries({
        queryKey: listAdminReviewsQueryKey(),
      });
    },
    onError: () => snackbar("후기를 삭제하지 못했습니다."),
  });

  const replaceQuery = (changes: Partial<typeof parsed>) => {
    setParams(serializeAdminListQuery({ ...parsed, ...changes }), {
      replace: true,
    });
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
    replaceQuery,
  });

  const columns: readonly AdminTableColumn<ReviewOut>[] = [
    {
      key: "created_at",
      header: "작성일",
      render: (review) => formatDateTime(review.created_at),
    },
    {
      key: "order_type",
      header: "유형",
      render: (review) => ORDER_TYPE_LABELS[review.order_type],
    },
    {
      key: "rating",
      header: "별점",
      render: (review) => (
        <Rating value={review.rating} aria-label={`${review.rating}점`} />
      ),
    },
    {
      key: "content",
      header: "내용",
      render: (review) => (
        <Text textStyle="bodySm" maxLines={2}>
          {review.content}
        </Text>
      ),
    },
    {
      key: "author",
      header: "작성자",
      render: (review) => review.author_name,
    },
    {
      key: "actions",
      header: "관리",
      render: (review) => (
        <ActionButton
          type="button"
          variant="ghost"
          size="small"
          onClick={() => setDeleteTarget(review)}
        >
          삭제
        </ActionButton>
      ),
    },
  ];

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="후기 관리"
        description="구매 후기를 유형과 별점으로 확인하고 삭제합니다."
      />
      <PaginatedAdminTableCard
        title="후기 목록"
        label="후기 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        status={
          query.isLoading || query.isPlaceholderData
            ? "loading"
            : query.isError
              ? "error"
              : "success"
        }
        total={query.data?.total}
        limit={parsed.limit}
        refreshing={query.isFetching}
        onRefresh={() => void query.refetch()}
        onRetry={() => void query.refetch()}
        emptyTitle="조건에 맞는 후기가 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="후기 목록 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              secondaryFilters={
                <VStack gap="x4" alignItems="stretch">
                  <FilterSelect
                    label="유형"
                    presentation="inline"
                    value={draftOrderType}
                    options={ORDER_TYPES.map((value) => ({
                      value,
                      label: ORDER_TYPE_LABELS[value],
                    }))}
                    onValueChange={(value) =>
                      setDraftOrderType(value as OrderType)
                    }
                  />
                  <FilterSelect
                    label="별점"
                    presentation="inline"
                    value={draftRating}
                    options={RATINGS.map((value) => ({
                      value,
                      label: value === "all" ? "전체" : `${value}점`,
                    }))}
                    onValueChange={(value) =>
                      setDraftRating(value as RatingFilter)
                    }
                  />
                </VStack>
              }
              secondaryFilterCount={
                Number(orderType !== "all") + Number(rating !== "all")
              }
              secondaryTitle="후기 필터"
              onOpenSecondaryFilters={() => {
                setDraftOrderType(orderType);
                setDraftRating(rating);
              }}
              onApplySecondaryFilters={() => {
                replaceQuery({
                  type: draftOrderType === "all" ? undefined : draftOrderType,
                  status: draftRating === "all" ? undefined : draftRating,
                  page: 1,
                });
                return undefined;
              }}
              onCancelSecondaryFilters={() => {
                setDraftOrderType(orderType);
                setDraftRating(rating);
              }}
            />
            <AppliedFilterBar
              filters={[
                orderType !== "all" && {
                  key: "type",
                  label: `유형: ${ORDER_TYPE_LABELS[orderType]}`,
                  onRemove: () => replaceQuery({ type: undefined, page: 1 }),
                },
                rating !== "all" && {
                  key: "rating",
                  label: `별점: ${rating}점`,
                  onRemove: () => replaceQuery({ status: undefined, page: 1 }),
                },
              ]}
              onReset={() =>
                replaceQuery({
                  page: 1,
                  limit: 20,
                  type: undefined,
                  status: undefined,
                })
              }
            />
          </VStack>
        }
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="후기를 삭제할까요?"
        description="삭제한 후기는 복구할 수 없습니다."
        primaryActionProps={{
          children: "삭제",
          variant: "criticalSolid",
          loading: deleteReview.isPending,
          onClick: () => {
            if (deleteTarget) {
              deleteReview.mutate({
                path: { review_id: deleteTarget.id },
              });
            }
          },
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </VStack>
  );
}
