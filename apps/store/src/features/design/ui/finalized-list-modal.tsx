import type { GenerationJobOut } from "@essesion/api-client";
import { Modal, Text, VStack } from "@essesion/shared";

import { FinalizedGallery } from "@/features/design/ui/finalized-gallery";

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
  onOrder,
  onDelete,
  ...gallery
}: FinalizedListModalProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="내 완성본"
      description="실사화를 마친 디자인이에요. 주문제작·샘플 제작에서 참조 이미지로 사용할 수 있어요."
      size="medium"
      showCloseButton
    >
      <VStack gap="x3" alignItems="stretch">
        <FinalizedGallery
          variant="browse"
          onOrder={onOrder}
          onDelete={onDelete}
          {...gallery}
        />
        <Text textStyle="captionSm" color="fg.neutral-subtle">
          실제 제작물은 장인이 직조 방식을 최종 결정하며 이미지와 다를 수
          있어요.
        </Text>
      </VStack>
    </Modal>
  );
}
