import type { GenerationJobOut } from "@essesion/api-client";
import {
  ActionButton,
  Callout,
  ContentPlaceholder,
  Grid,
  HStack,
  Icon,
  ImageFrame,
  ResponsiveModal,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ExclamationTriangleIcon,
  PhotoIcon,
  ShoppingBagIcon,
  SwatchIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export type FinalizedListModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: readonly GenerationJobOut[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: boolean;
  onLoadMore?: () => void;
  /** 완성본을 참조 디자인으로 주문제작 플로우에 넘긴다. */
  onOrder: (job: GenerationJobOut) => void;
  onDelete: (job: GenerationJobOut) => void;
};

/** 실사화를 마친 완성본 보관함 — 세션과 독립적으로 유지된다. */
export function FinalizedListModal({
  open,
  onOpenChange,
  jobs,
  loading = false,
  error = false,
  onRetry,
  hasMore = false,
  loadingMore = false,
  loadMoreError = false,
  onLoadMore,
  onOrder,
  onDelete,
}: FinalizedListModalProps) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="내 완성본"
      description="실사화를 마친 디자인이에요. 주문제작·샘플 제작에서 참조 이미지로 사용할 수 있어요."
      size="medium"
      showCloseButton
    >
      {loading ? (
        <FinalizedListSkeleton />
      ) : error ? (
        <ContentPlaceholder
          icon={<Icon svg={<ExclamationTriangleIcon />} size={32} />}
          title="완성본을 불러오지 못했어요"
          description="잠시 후 다시 시도해 주세요."
          action={
            onRetry ? (
              <ActionButton
                type="button"
                variant="neutralWeak"
                size="small"
                onClick={onRetry}
              >
                다시 시도
              </ActionButton>
            ) : undefined
          }
        />
      ) : jobs.length === 0 ? (
        <ContentPlaceholder
          icon={<Icon svg={<SwatchIcon />} size={32} />}
          title="완성한 디자인이 없어요"
          description="실사화를 완성하면 여기에 모여요."
        />
      ) : (
        <Grid columns={2} gap="x3" aria-label="내 완성본">
          {jobs.map((job, index) => (
            <VStack
              key={job.id}
              gap="x2"
              alignItems="stretch"
              borderWidth={1}
              borderColor="stroke.neutral-weak"
              borderRadius="r3"
              p="x2"
              bg="bg.layer-default"
            >
              <ImageFrame
                ratio={1}
                src={job.result_url ?? undefined}
                alt={`완성본 ${index + 1}`}
                fit="cover"
                borderRadius="r2"
                fallback={
                  <VStack
                    position="absolute"
                    inset={0}
                    align="center"
                    justify="center"
                    gap="x2"
                    bg="bg.neutral-weak"
                  >
                    <Icon svg={<PhotoIcon />} size={28} />
                    <Text textStyle="captionSm" color="fg.neutral-subtle">
                      미리보기 없음
                    </Text>
                  </VStack>
                }
              />
              <Text textStyle="captionSm" color="fg.neutral-muted" px="x1">
                {formatDate(job.created_at)}
              </Text>
              <HStack gap="x1" justify="space-between">
                <ActionButton
                  type="button"
                  size="small"
                  variant="neutralWeak"
                  onClick={() => onOrder(job)}
                >
                  <Icon svg={<ShoppingBagIcon />} size={16} />
                  주문제작
                </ActionButton>
                <ActionButton
                  type="button"
                  size="small"
                  variant="ghost"
                  aria-label={`완성본 ${index + 1} 삭제`}
                  onClick={() => onDelete(job)}
                >
                  <Icon svg={<TrashIcon />} size={16} />
                </ActionButton>
              </HStack>
            </VStack>
          ))}
          {onLoadMore && (loadMoreError || hasMore) ? (
            <VStack gridColumn="1 / -1" pt="x1" alignItems="stretch">
              {loadMoreError ? (
                <Callout
                  tone="critical"
                  title="이전 완성본을 불러오지 못했어요"
                  description="눌러서 다시 시도해 주세요."
                  onClick={onLoadMore}
                />
              ) : (
                <HStack justify="center">
                  <ActionButton
                    type="button"
                    variant="neutralOutline"
                    loading={loadingMore}
                    onClick={onLoadMore}
                  >
                    더 보기
                  </ActionButton>
                </HStack>
              )}
            </VStack>
          ) : null}
        </Grid>
      )}
    </ResponsiveModal>
  );
}

function FinalizedListSkeleton() {
  return (
    <Grid columns={2} gap="x3" aria-busy="true" aria-label="완성본 불러오는 중">
      {Array.from({ length: 4 }, (_, index) => (
        <VStack key={index} gap="x2" alignItems="stretch">
          <Skeleton width="100%" radius="r2" style={{ aspectRatio: 1 }} />
          <Skeleton width="70%" height={16} />
        </VStack>
      ))}
    </Grid>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}
