import {
  Box,
  ContentPlaceholder,
  Icon,
  ResponsiveModal,
  SegmentedControl,
  SegmentedControlItem,
  VStack,
} from "@essesion/shared";
import { PhotoIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

import { type DesignPreviewMode, TieCanvas } from "./tie-canvas";

export type PreviewModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageSrc?: string | null;
  alt?: string;
  mode: DesignPreviewMode;
  onModeChange: (mode: DesignPreviewMode) => void;
  actions?: ReactNode;
};

export function PreviewModal({
  open,
  onOpenChange,
  imageSrc,
  alt,
  mode,
  onModeChange,
  actions,
}: PreviewModalProps) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="디자인 미리보기"
      description="타일과 넥타이 적용 모습을 확인할 수 있어요."
      size="medium"
      showCloseButton
      footer={actions}
    >
      <VStack gap="x4" alignItems="stretch">
        <SegmentedControl
          value={mode}
          onValueChange={(value) => onModeChange(value as DesignPreviewMode)}
          aria-label="미리보기 방식"
          className="w-full"
        >
          <SegmentedControlItem value="repeat">타일</SegmentedControlItem>
          <SegmentedControlItem value="tie">넥타이</SegmentedControlItem>
        </SegmentedControl>

        {imageSrc ? (
          <Box>
            <TieCanvas imageSrc={imageSrc} mode={mode} alt={alt} />
          </Box>
        ) : (
          <ContentPlaceholder
            icon={<Icon svg={<PhotoIcon />} size={32} />}
            title="미리 볼 후보가 없어요"
            description="후보를 선택한 뒤 다시 열어 주세요."
          />
        )}
      </VStack>
    </ResponsiveModal>
  );
}
