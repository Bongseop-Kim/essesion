import {
  createReviewMutation,
  deleteReviewMutation,
  getOrderQueryKey,
  getReviewOptions,
  getReviewQueryKey,
  listMyOrdersQueryKey,
  listReviewsQueryKey,
  updateReviewMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Box,
  ContentPlaceholder,
  Field,
  HStack,
  Rating,
  ResponsiveModal,
  Skeleton,
  snackbar,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { dateMedium } from "@/shared/lib/format";

const OVERLAY_EXIT_MS = 250;

export type ReviewTarget = {
  orderId: string;
  orderItemId?: string;
  reviewId?: string;
};

type ReviewFormModalProps = {
  open: boolean;
  target: ReviewTarget | null;
  onOpenChange: (open: boolean) => void;
};

export function ReviewFormModal({
  open,
  target,
  onOpenChange,
}: ReviewFormModalProps) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteTimer = useRef<number | undefined>(undefined);
  const reviewQuery = useQuery({
    ...getReviewOptions({ path: { review_id: target?.reviewId ?? "" } }),
    enabled: open && target?.reviewId !== undefined,
  });
  const createReview = useMutation(createReviewMutation());
  const updateReview = useMutation(updateReviewMutation());
  const deleteReview = useMutation(deleteReviewMutation());
  const saving = createReview.isPending || updateReview.isPending;

  useEffect(() => {
    if (!open || !target) return;
    if (target.reviewId === undefined) {
      setRating(5);
      setContent("");
      setEditing(true);
      return;
    }
    if (reviewQuery.data?.id === target.reviewId) {
      setRating(reviewQuery.data.rating);
      setContent(reviewQuery.data.content);
      setEditing(false);
    }
  }, [open, reviewQuery.data, target]);

  useEffect(() => () => window.clearTimeout(deleteTimer.current), []);

  const invalidate = async (reviewId?: string) => {
    if (!target) return;
    const tasks = [
      queryClient.invalidateQueries({
        queryKey: getOrderQueryKey({ path: { order_id: target.orderId } }),
      }),
      queryClient.invalidateQueries({ queryKey: listMyOrdersQueryKey() }),
      queryClient.invalidateQueries({ queryKey: listReviewsQueryKey() }),
    ];
    if (reviewId) {
      tasks.push(
        queryClient.invalidateQueries({
          queryKey: getReviewQueryKey({ path: { review_id: reviewId } }),
        }),
      );
    }
    await Promise.all(tasks);
  };

  const save = async () => {
    if (!target || content.trim().length === 0 || saving) return;
    try {
      const review = target.reviewId
        ? await updateReview.mutateAsync({
            path: { review_id: target.reviewId },
            body: { rating, content: content.trim() },
          })
        : await createReview.mutateAsync({
            body: {
              order_id: target.orderId,
              order_item_id: target.orderItemId,
              rating,
              content: content.trim(),
            },
          });
      await invalidate(review.id);
      onOpenChange(false);
      snackbar(
        target.reviewId ? "후기를 수정했습니다." : "후기를 등록했습니다.",
      );
    } catch {
      snackbar("후기를 저장하지 못했습니다. 다시 시도해 주세요.");
    }
  };

  const requestDelete = () => {
    onOpenChange(false);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    deleteTimer.current = window.setTimeout(
      () => setDeleteOpen(true),
      reducedMotion ? 0 : OVERLAY_EXIT_MS,
    );
  };

  const confirmDelete = async () => {
    if (!target?.reviewId) return;
    try {
      await deleteReview.mutateAsync({
        path: { review_id: target.reviewId },
      });
      await invalidate(target.reviewId);
      setDeleteOpen(false);
      snackbar("후기를 삭제했습니다.");
    } catch {
      snackbar("후기를 삭제하지 못했습니다. 다시 시도해 주세요.");
    }
  };

  const existing = target?.reviewId !== undefined;
  const footer = editing ? (
    <HStack justify="flex-end" gap="x2">
      {existing ? (
        <ActionButton
          type="button"
          variant="neutralOutline"
          disabled={saving}
          onClick={() => setEditing(false)}
        >
          취소
        </ActionButton>
      ) : null}
      <ActionButton
        type="button"
        loading={saving}
        disabled={content.trim().length === 0}
        onClick={() => void save()}
      >
        {existing ? "수정" : "등록"}
      </ActionButton>
    </HStack>
  ) : undefined;

  return (
    <>
      <ResponsiveModal
        open={open}
        onOpenChange={onOpenChange}
        title={existing ? "작성한 후기" : "후기 작성"}
        description={
          existing
            ? "작성한 별점과 내용을 확인할 수 있습니다."
            : "서비스 이용 경험을 별점과 함께 남겨 주세요."
        }
        showCloseButton
        size="small"
        footer={footer}
      >
        {existing && reviewQuery.isPending ? (
          <VStack gap="x3" alignItems="stretch" aria-busy="true">
            <Skeleton width="50%" height={24} />
            <Skeleton width="100%" height={120} />
          </VStack>
        ) : existing && (reviewQuery.isError || !reviewQuery.data) ? (
          <ContentPlaceholder
            title="후기를 불러오지 못했습니다"
            action={
              <ActionButton onClick={() => void reviewQuery.refetch()}>
                다시 시도
              </ActionButton>
            }
          />
        ) : editing ? (
          <VStack gap="x5" alignItems="stretch">
            <Field label="별점" required>
              <Rating value={rating} onChange={setRating} />
            </Field>
            <TextAreaField
              label="후기 내용"
              required
              rows={7}
              autoResize
              maxLength={1000}
              value={content}
              description={`${content.length}/1,000자`}
              errorMessage={
                content.length > 0 && content.trim().length === 0
                  ? "후기 내용을 입력해 주세요."
                  : undefined
              }
              disabled={saving}
              onChange={(event) => setContent(event.currentTarget.value)}
            />
          </VStack>
        ) : reviewQuery.data ? (
          <VStack gap="x5" alignItems="stretch">
            <HStack justify="space-between" gap="x3" wrap>
              <Rating value={reviewQuery.data.rating} />
              <Text textStyle="caption" color="fg.neutral-muted">
                {dateMedium.format(new Date(reviewQuery.data.created_at))}
              </Text>
            </HStack>
            <Box bg="bg.neutral-weak" borderRadius="r2" p="x4">
              <Text className="whitespace-pre-wrap break-words">
                {reviewQuery.data.content}
              </Text>
            </Box>
            <HStack gap="x2" wrap>
              <ActionButton
                type="button"
                variant="neutralOutline"
                onClick={() => setEditing(true)}
              >
                수정
              </ActionButton>
              <ActionButton
                type="button"
                variant="ghost"
                onClick={requestDelete}
              >
                삭제
              </ActionButton>
            </HStack>
          </VStack>
        ) : null}
      </ResponsiveModal>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="후기를 삭제할까요?"
        description="삭제한 후기는 복구할 수 없습니다."
        primaryActionProps={{
          children: "삭제",
          variant: "criticalSolid",
          loading: deleteReview.isPending,
          onClick: () => void confirmDelete(),
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </>
  );
}
