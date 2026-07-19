import {
  Box,
  ContentPlaceholder,
  Flex,
  HStack,
  Icon,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  VStack,
} from "@essesion/shared";
import { PhotoIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

import { type DesignPreviewMode, TieCanvas } from "./tie-canvas";

export type PreviewPanelProps = {
  imageSrc?: string | null;
  alt?: string;
  mode: DesignPreviewMode;
  onModeChange: (mode: DesignPreviewMode) => void;
  actions?: ReactNode;
  title?: string;
};

export function PreviewPanel({
  imageSrc,
  alt,
  mode,
  onModeChange,
  actions,
  title = "디자인 미리보기",
}: PreviewPanelProps) {
  return (
    <VStack
      height="full"
      minHeight={0}
      alignItems="stretch"
      overflow="hidden"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r4"
      bg="bg.layer-default"
    >
      <HStack justify="space-between" gap="x3" px="x5" py="x4">
        <Text as="h2" textStyle="title3">
          {title}
        </Text>

        <SegmentedControl
          value={mode}
          onValueChange={(value) => onModeChange(value as DesignPreviewMode)}
          aria-label="미리보기 방식"
        >
          <SegmentedControlItem value="repeat">타일</SegmentedControlItem>
          <SegmentedControlItem value="tie">넥타이</SegmentedControlItem>
        </SegmentedControl>
      </HStack>

      <Flex
        minHeight={0}
        flex={1}
        align="center"
        justify="center"
        overflow="hidden"
        p="x5"
        bg="bg.layer-basement"
      >
        {imageSrc ? (
          <Box width="full" height="full">
            <TieCanvas imageSrc={imageSrc} mode={mode} alt={alt} />
          </Box>
        ) : (
          <ContentPlaceholder
            icon={<Icon svg={<PhotoIcon />} size={32} />}
            title="후보를 선택해 주세요"
            description="선택한 패턴의 타일과 넥타이 적용 모습을 확인할 수 있어요."
          />
        )}
      </Flex>

      {actions ? (
        <Box px="x5" py="x4" className="border-t border-stroke-neutral-weak">
          {actions}
        </Box>
      ) : null}
    </VStack>
  );
}
