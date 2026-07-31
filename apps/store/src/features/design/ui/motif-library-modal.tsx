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
  ArrowUpTrayIcon,
  BookmarkSquareIcon,
  ExclamationTriangleIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { svgToDataUri } from "../model/svg-preview";

export type MotifLibraryModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  motifs: readonly UserMotifOut[];
  /** 슬롯에 넣을 모티프 하나를 고른다 — 교체는 무과금 재렌더다. */
  onSelect: (motif: UserMotifOut) => void;
  onDelete: (motif: UserMotifOut) => void;
  /** 지금 슬롯에 들어 있는 모티프 id — 이미 쓰는 그림을 표시만 한다. */
  activeIds?: readonly string[];
  /** SVG 파일에서 새 모티프를 만드는 유일한 진입점(5단계에서 문장 검색과 합쳐진다). */
  onImportSvg?: () => void;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
};

export function MotifLibraryModal({
  open,
  onOpenChange,
  motifs,
  onSelect,
  onDelete,
  activeIds = [],
  onImportSvg,
  loading = false,
  error = false,
  onRetry,
}: MotifLibraryModalProps) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="모티프 바꾸기"
      description="이 슬롯에 넣을 그림을 하나 골라 주세요. 교체에는 토큰이 들지 않아요."
      size="medium"
      showCloseButton
      footer={
        onImportSvg ? (
          <ActionButton
            type="button"
            variant="neutralOutline"
            size="medium"
            onClick={onImportSvg}
          >
            <Icon svg={<ArrowUpTrayIcon />} size={18} />
            SVG 올리기
          </ActionButton>
        ) : undefined
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
          description="SVG·사진·글자로 만든 모티프가 여기에 모입니다."
        />
      ) : (
        <VStack gap="x2" alignItems="stretch">
          {motifs.map((motif) => {
            const selected = activeIds.includes(motif.motif_id);
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
                  aria-label={`${motif.name} 모티프로 바꾸기`}
                  onClick={() => onSelect(motif)}
                  className="text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
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
                        {selected
                          ? "지금 쓰는 그림"
                          : "탭하여 이 그림으로 바꾸기"}
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
