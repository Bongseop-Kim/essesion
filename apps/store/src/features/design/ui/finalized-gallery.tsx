import type { GenerationJobOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  Callout,
  ContentPlaceholder,
  type DesignPreviewMode,
  Flex,
  Float,
  Grid,
  HStack,
  Icon,
  ImageFrame,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ArrowLeftIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  PhotoIcon,
  ShoppingBagIcon,
  SwatchIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";

import { ViewToggle } from "@/features/design/ui/view-toggle";
import { formatDateTime } from "@/shared/lib/format";

const formatDate = (value: string) =>
  formatDateTime(
    value,
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    value,
  );

/** 빈 상태 설명만 variant별 — 피커에서는 어디서 만드는지 알려줘야 한다. */
const EMPTY_DESCRIPTION = {
  browse: "실사화를 완성하면 여기에 모여요.",
  select: "디자인 페이지에서 실사화를 먼저 완성해 주세요.",
} as const;

export type FinalizedGalleryProps = {
  jobs: readonly GenerationJobOut[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: boolean;
  onLoadMore?: () => void;
} & (
  | {
      variant: "browse";
      onOrder: (job: GenerationJobOut) => void;
      onDelete: (job: GenerationJobOut) => void;
    }
  | {
      variant: "select";
      selectedId: string | null;
      onSelect: (job: GenerationJobOut) => void;
    }
);

/** browse 카드 이미지 클릭으로 진입하는 인라인 확대 뷰의 대상. */
type ExpandedView = {
  id: string;
  src: string;
  index: number;
  createdAt: string;
};

/**
 * 완성본 목록 본문 — 완성본 모달과 주문제작 디자인 피커가 공유한다.
 *
 * 두 화면은 같은 목록(kind=finalize, status=succeeded)을 같은 그리드로 보여주므로
 * 토글·페이지네이션·빈 상태·카드 마크업을 여기서만 소유한다. 호출측은 Modal 크롬만 남긴다.
 */
export function FinalizedGallery(props: FinalizedGalleryProps) {
  const {
    jobs,
    loading = false,
    error = false,
    onRetry,
    hasMore = false,
    loadingMore = false,
    loadMoreError = false,
    onLoadMore,
    variant,
  } = props;
  // AI 실사 2장(넥타이 / 원단) 사이의 토글 — 같은 타일의 두 렌더가 아니라 서로 다른
  // 두 이미지다. 토글 1개가 목록 전체에 동시 적용된다.
  const [previewMode, setPreviewMode] = useState<DesignPreviewMode>("tie");
  // 인라인 확대 — 모달 위 모달 금지(overlay.md)라 새 오버레이 대신 콘텐츠를 전환한다.
  // browse 카드에서만 진입하므로 select variant에는 도달하지 않는다.
  const [expanded, setExpanded] = useState<ExpandedView | null>(null);
  const expandTriggers = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusId = useRef<string | null>(null);

  // 뒤로 복귀 시 확대를 열었던 카드 버튼으로 포커스 복원 (확대 중에는 그리드가 언마운트).
  useEffect(() => {
    if (expanded == null && restoreFocusId.current != null) {
      expandTriggers.current.get(restoreFocusId.current)?.focus();
      restoreFocusId.current = null;
    }
  }, [expanded]);

  if (loading) return <FinalizedGallerySkeleton />;
  if (error)
    return (
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
    );
  if (jobs.length === 0)
    return (
      <ContentPlaceholder
        icon={<Icon svg={<SwatchIcon />} size={32} />}
        title="완성한 디자인이 없어요"
        description={EMPTY_DESCRIPTION[variant]}
      />
    );

  if (expanded != null)
    return (
      <VStack gap="x3" alignItems="stretch">
        <HStack>
          <ActionButton
            type="button"
            size="small"
            variant="ghost"
            // 콘텐츠 전환이라 dialog 포커스 이동이 없다 — 진입 포커스를 직접 준다.
            autoFocus
            onClick={() => {
              restoreFocusId.current = expanded.id;
              setExpanded(null);
            }}
          >
            <Icon svg={<ArrowLeftIcon />} size={16} />
            목록으로
          </ActionButton>
        </HStack>
        <ImageFrame
          ratio="auto"
          borderRadius="r4"
          src={expanded.src}
          alt={`완성본 ${expanded.index + 1} 확대`}
        />
        <Text as="span" textStyle="captionSm" color="fg.neutral-muted" px="x1">
          {formatDate(expanded.createdAt)}
        </Text>
      </VStack>
    );

  return (
    <VStack gap="x3" alignItems="stretch">
      <HStack justify="flex-end">
        <ViewToggle
          mode={previewMode}
          onModeChange={setPreviewMode}
          repeatLabel="원단"
        />
      </HStack>
      <Grid columns={2} gap="x3" aria-label="내 완성본">
        {jobs.map((job, index) => (
          <FinalizedCard
            key={job.id}
            job={job}
            index={index}
            previewMode={previewMode}
            actions={props}
            onExpand={setExpanded}
            registerExpandTrigger={(id, node) => {
              if (node == null) expandTriggers.current.delete(id);
              else expandTriggers.current.set(id, node);
            }}
          />
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
    </VStack>
  );
}

function FinalizedCard({
  job,
  index,
  previewMode,
  actions,
  onExpand,
  registerExpandTrigger,
}: {
  job: GenerationJobOut;
  index: number;
  previewMode: DesignPreviewMode;
  actions: FinalizedGalleryProps;
  onExpand: (view: ExpandedView) => void;
  registerExpandTrigger: (id: string, node: HTMLButtonElement | null) => void;
}) {
  const tie = previewMode === "tie";
  const checked = actions.variant === "select" && actions.selectedId === job.id;
  // 레거시 finalize 행(실사 URL 없음)은 원단 한 장으로 간주해 표시만 호환.
  const src = (tie ? job.tie_url : job.fabric_url) ?? job.result_url ?? null;
  const image = (
    <ImageFrame
      ratio={1}
      borderRadius="r4"
      src={src ?? undefined}
      alt={`완성본 ${index + 1}`}
      // 넥타이 실사의 원본은 베이스 사진 비율 2:3 — cover면 매듭·끝단이 잘린다.
      fit={tie ? "contain" : "cover"}
      className={tie ? "bg-bg-neutral-weak" : undefined}
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
    >
      {checked ? (
        <Float placement="top-end" offsetX="x2" offsetY="x2">
          <Flex
            align="center"
            justify="center"
            width={28}
            height={28}
            borderRadius="full"
            bg="bg.brand-solid"
            className="text-fg-contrast"
          >
            <Icon svg={<CheckIcon />} size={18} />
          </Flex>
        </Float>
      ) : null}
    </ImageFrame>
  );
  const caption = (
    <Text as="span" textStyle="captionSm" color="fg.neutral-muted" px="x1">
      {formatDate(job.created_at)}
    </Text>
  );

  // 셸 요소만 갈린다 — browse 카드는 안에 버튼이 있어 button으로 감쌀 수 없다.
  if (actions.variant === "select")
    return (
      <VStack
        as="button"
        type="button"
        aria-pressed={checked}
        aria-label={`완성 디자인 ${index + 1}`}
        onClick={() => actions.onSelect(job)}
        borderWidth={2}
        borderColor={checked ? "stroke.brand" : "stroke.neutral-weak"}
        bg={checked ? "bg.brand-weak" : "bg.layer-default"}
        className="text-left transition-colors duration-100 ease-standard hover:border-stroke-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
        gap="x2"
        alignItems="stretch"
        borderRadius="r3"
        p="x2"
      >
        {image}
        {caption}
      </VStack>
    );

  return (
    <VStack
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      bg="bg.layer-default"
      gap="x2"
      alignItems="stretch"
      borderRadius="r3"
      p="x2"
    >
      {src != null ? (
        <Box
          as="button"
          type="button"
          ref={(node: HTMLButtonElement | null) =>
            registerExpandTrigger(job.id, node)
          }
          aria-label={`완성본 ${index + 1} 크게 보기`}
          onClick={() =>
            onExpand({ id: job.id, src, index, createdAt: job.created_at })
          }
          borderRadius="r4"
          className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
        >
          {image}
        </Box>
      ) : (
        // 레거시 행에 URL이 하나도 없으면(폴백 실루엣) 확대할 원본이 없다.
        image
      )}
      {caption}
      <HStack gap="x1" justify="space-between">
        <ActionButton
          type="button"
          size="small"
          variant="neutralWeak"
          onClick={() => actions.onOrder(job)}
        >
          <Icon svg={<ShoppingBagIcon />} size={16} />
          주문제작
        </ActionButton>
        <ActionButton
          type="button"
          size="small"
          variant="ghost"
          aria-label={`완성본 ${index + 1} 삭제`}
          onClick={() => actions.onDelete(job)}
        >
          <Icon svg={<TrashIcon />} size={16} />
        </ActionButton>
      </HStack>
    </VStack>
  );
}

function FinalizedGallerySkeleton() {
  return (
    <Grid columns={2} gap="x3" aria-busy="true" aria-label="완성본 불러오는 중">
      {Array.from({ length: 4 }, (_, index) => (
        <VStack key={index} gap="x2" alignItems="stretch">
          <Skeleton width="100%" radius="r4" style={{ aspectRatio: 1 }} />
          <Skeleton width="70%" height={16} />
        </VStack>
      ))}
    </Grid>
  );
}
