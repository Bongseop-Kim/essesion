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
import {
  MagnifyingGlassPlusIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";
import type { PointerEvent, ReactNode } from "react";
import { useState } from "react";

import {
  type DesignPreviewMode,
  type DesignPreviewTransform,
  TieCanvas,
} from "./tie-canvas";

export type PreviewPanelProps = {
  imageSrc?: string | null;
  alt?: string;
  mode: DesignPreviewMode;
  onModeChange: (mode: DesignPreviewMode) => void;
  actions?: ReactNode;
  title?: string;
};

const RESTING_TRANSFORM: DesignPreviewTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export function PreviewPanel({
  imageSrc,
  alt,
  mode,
  onModeChange,
  actions,
  title = "디자인 미리보기",
}: PreviewPanelProps) {
  const [hoverTransform, setHoverTransform] =
    useState<DesignPreviewTransform>(RESTING_TRANSFORM);

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setHoverTransform({
      scale: 1.8,
      offsetX: 0,
      offsetY: 0,
      originX: ((event.clientX - bounds.left) / bounds.width) * 100,
      originY: ((event.clientY - bounds.top) / bounds.height) * 100,
    });
  };

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
        <VStack gap="x0_5" minWidth={0} alignItems="stretch">
          <Text as="h2" textStyle="title3">
            {title}
          </Text>
          {imageSrc ? (
            <HStack gap="x1" className="text-fg-neutral-subtle">
              <Icon svg={<MagnifyingGlassPlusIcon />} size={16} />
              <Text textStyle="captionSm" color="fg.neutral-subtle">
                마우스를 움직여 확대할 수 있어요
              </Text>
            </HStack>
          ) : null}
        </VStack>

        <SegmentedControl
          value={mode}
          onValueChange={(value) => onModeChange(value as DesignPreviewMode)}
          aria-label="미리보기 방식"
        >
          <SegmentedControlItem value="repeat">반복</SegmentedControlItem>
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
          <Box
            width="full"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverTransform(RESTING_TRANSFORM)}
          >
            <TieCanvas
              imageSrc={imageSrc}
              mode={mode}
              alt={alt}
              transform={hoverTransform}
            />
          </Box>
        ) : (
          <ContentPlaceholder
            icon={<Icon svg={<PhotoIcon />} size={32} />}
            title="후보를 선택해 주세요"
            description="선택한 패턴의 반복과 넥타이 적용 모습을 확인할 수 있어요."
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
