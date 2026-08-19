import type { DesignExampleOut } from "@essesion/api-client";
import {
  Box,
  Grid,
  ImageFrame,
  ScrollFog,
  Text,
  VStack,
} from "@essesion/shared";

import { svgToDataUri } from "@/features/design/model/svg-preview";

export type StarterGalleryProps = {
  /** 공개 큐레이션 예시 — 0개면 페이지가 기존 빈 상태로 폴백한다 */
  examples: readonly DesignExampleOut[];
  onSelect: (example: DesignExampleOut) => void;
  disabled?: boolean;
};

/** 모바일은 한 줄 스크롤, PC는 예시가 적어도 가운데에 모이는 4열 그리드. */
const MOBILE_CARD_WIDTH = 130;
const CARD_WIDTH = 176;

/** 첫 진입 캔버스 — 빈 상태 대신 예시를 깔아 두고, 고르면 그 디자인에서 시작한다. */
export function StarterGallery({
  examples,
  onSelect,
  disabled = false,
}: StarterGalleryProps) {
  const desktopColumns = Math.min(examples.length, 4);
  return (
    <VStack
      gap="x5"
      alignItems="center"
      width="full"
      maxWidth={720}
      height={{ base: "full", md: "auto" }}
      minHeight={0}
      pt={{ base: "x12", md: 0 }}
      overflowY="auto"
    >
      {/* 상단 pill(Help·뷰·토큰) 아래로만 내린다 — 더 내리면 카드 라벨이 우하단 모티프 패널에 가린다 */}
      <Box display={{ base: "block", md: "none" }} height={80} aria-hidden />
      <VStack gap="x1" alignItems="center">
        <Text as="h2" textStyle="title3">
          예시에서 시작해 보세요
        </Text>
        <Text textStyle="caption" color="fg.neutral-muted" align="center">
          고르면 토큰 없이 바로 캔버스에 올라와요. 마음에 드는 걸 고른 뒤
          문장으로 고쳐 나가면 됩니다.
        </Text>
      </VStack>
      <Box width="full">
        <ScrollFog className="snap-x snap-mandatory">
          <Grid
            columns={{ base: examples.length, md: desktopColumns }}
            gap="x3"
            width={{ base: "max-content", md: "full" }}
            maxWidth={{ base: "max-content", md: desktopColumns * CARD_WIDTH }}
            mx={{ base: 0, md: "auto" }}
          >
            {examples.map((example) => (
              <Box
                key={example.id}
                width={{ base: MOBILE_CARD_WIDTH, md: "full" }}
                className="snap-start"
              >
                <StarterCard
                  example={example}
                  disabled={disabled}
                  onSelect={onSelect}
                />
              </Box>
            ))}
          </Grid>
        </ScrollFog>
      </Box>
    </VStack>
  );
}

/**
 * 팬톤 칩 카드 — 타일은 카드 폭을 꽉 채워(cover) 흰 여백을 만들지 않고,
 * 이름·설명은 아래 흰 라벨 면이 받는다. 카드 자체가 클릭 타깃이다.
 */
function StarterCard({
  example,
  disabled,
  onSelect,
}: {
  example: DesignExampleOut;
  disabled: boolean;
  onSelect: (example: DesignExampleOut) => void;
}) {
  return (
    <VStack
      as="button"
      type="button"
      alignItems="stretch"
      width="full"
      height="full"
      overflow="hidden"
      borderRadius="r3"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      bg="bg.layer-default"
      boxShadow="s1"
      onClick={() => onSelect(example)}
      disabled={disabled}
      aria-label={`${example.name} 예시로 시작하기`}
      className="text-start transition-shadow duration-100 ease-standard hover:shadow-s2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
    >
      {/* borderRadius 0 — 모서리는 카드가 잘라내고 타일은 면을 끝까지 채운다 */}
      <ImageFrame
        ratio={1}
        borderRadius={0}
        fit="cover"
        src={svgToDataUri(example.preview_svg)}
        alt=""
      />
      <VStack alignItems="stretch" gap="x0_5" px="x3" py="x2_5" flex={1}>
        <Text textStyle="labelSm" maxLines={1}>
          {example.name}
        </Text>
        {example.caption ? (
          <Text textStyle="captionSm" color="fg.neutral-muted" maxLines={1}>
            {example.caption}
          </Text>
        ) : null}
      </VStack>
    </VStack>
  );
}
