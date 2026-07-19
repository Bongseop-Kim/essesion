import type { UserMotifOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  HStack,
  Icon,
  ImageFrame,
  ResponsiveModal,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import {
  BookmarkSquareIcon,
  ExclamationTriangleIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { svgToDataUri } from "../model/svg-preview";

export type MotifLibraryModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  motifs: readonly UserMotifOut[];
  selectedIds: readonly string[];
  max: number;
  onToggle: (motif: UserMotifOut) => void;
  onDelete: (motif: UserMotifOut) => void;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
};

export function MotifLibraryModal({
  open,
  onOpenChange,
  motifs,
  selectedIds,
  max,
  onToggle,
  onDelete,
  loading = false,
  error = false,
  onRetry,
}: MotifLibraryModalProps) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="내 모티프"
      description={`이번 생성에 사용할 모티프를 최대 ${max}개 선택해 주세요.`}
      size="medium"
      showCloseButton
      footer={
        <Text textStyle="captionSm" color="fg.neutral-subtle">
          {selectedIds.length}/{max}개 선택
        </Text>
      }
    >
      {loading ? (
        <MotifListSkeleton />
      ) : error ? (
        <ContentPlaceholder
          icon={<Icon svg={<ExclamationTriangleIcon />} size={32} />}
          title="모티프를 불러오지 못했어요"
          description="잠시 후 다시 시도해 주세요."
          action={
            onRetry ? (
              <ActionButton
                type="button"
                size="small"
                variant="neutralWeak"
                onClick={onRetry}
              >
                다시 시도
              </ActionButton>
            ) : undefined
          }
        />
      ) : motifs.length === 0 ? (
        <ContentPlaceholder
          icon={<Icon svg={<BookmarkSquareIcon />} size={32} />}
          title="저장한 모티프가 없어요"
          description="+ 메뉴의 SVG 첨부로 첫 모티프를 추가해 보세요."
        />
      ) : (
        <VStack gap="x2" alignItems="stretch">
          {motifs.map((motif) => {
            const selected = selectedIds.includes(motif.id);
            const limitReached = !selected && selectedIds.length >= max;
            return (
              <HStack
                key={motif.id}
                gap="x2"
                borderWidth={1}
                borderColor={selected ? "stroke.brand" : "stroke.neutral-weak"}
                borderRadius="r3"
                bg={selected ? "bg.brand-weak" : "bg.layer-default"}
                p="x2"
              >
                <Box
                  as="button"
                  type="button"
                  flex={1}
                  minWidth={0}
                  disabled={limitReached}
                  aria-pressed={selected}
                  aria-label={`${motif.name} ${selected ? "선택 해제" : "선택"}`}
                  onClick={() => onToggle(motif)}
                  className="text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:opacity-50"
                >
                  <HStack gap="x3">
                    <Box width={64} height={64} className="shrink-0">
                      <ImageFrame
                        ratio={1}
                        src={svgToDataUri(motif.preview_svg)}
                        alt=""
                        fit="contain"
                        stroke
                      />
                    </Box>
                    <VStack gap="x1" alignItems="stretch" minWidth={0}>
                      <Text textStyle="labelSm" className="truncate">
                        {motif.name}
                      </Text>
                      <Text textStyle="captionSm" color="fg.neutral-subtle">
                        {selected ? "사용할 모티프로 선택됨" : "탭하여 선택"}
                      </Text>
                    </VStack>
                  </HStack>
                </Box>
                <ActionButton
                  type="button"
                  size="small"
                  variant="ghost"
                  aria-label={`${motif.name} 모티프 삭제`}
                  onClick={() => onDelete(motif)}
                >
                  <Icon svg={<TrashIcon />} size={18} />
                </ActionButton>
              </HStack>
            );
          })}
        </VStack>
      )}
    </ResponsiveModal>
  );
}

function MotifListSkeleton() {
  return (
    <VStack
      gap="x2"
      alignItems="stretch"
      aria-busy="true"
      aria-label="내 모티프 불러오는 중"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <HStack
          key={index}
          gap="x3"
          borderWidth={1}
          borderColor="stroke.neutral-weak"
          borderRadius="r3"
          p="x2"
        >
          <Skeleton width={64} height={64} radius="r2" />
          <VStack gap="x2" alignItems="stretch" flex={1}>
            <Skeleton width="45%" height={18} />
            <Skeleton width="30%" height={16} />
          </VStack>
        </HStack>
      ))}
    </VStack>
  );
}
