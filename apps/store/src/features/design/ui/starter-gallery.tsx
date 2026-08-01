import type { DesignExampleOut } from "@essesion/api-client";
import { Grid, ImageFrame, Text, VStack } from "@essesion/shared";

import { svgToDataUri } from "@/features/design/model/svg-preview";

export type StarterGalleryProps = {
  /** 공개 큐레이션 예시 — 0개면 페이지가 기존 빈 상태로 폴백한다 */
  examples: readonly DesignExampleOut[];
  onSelect: (example: DesignExampleOut) => void;
  disabled?: boolean;
};

/** 카드 한 장의 폭 상한 — 그리드를 이 값으로 묶어 예시가 적어도 가운데에 모인다. */
const CARD_WIDTH = 176;

/** 첫 진입 캔버스 — 빈 상태 대신 예시를 깔아 두고, 고르면 그 디자인에서 시작한다. */
export function StarterGallery({
  examples,
  onSelect,
  disabled = false,
}: StarterGalleryProps) {
  const columns = {
    base: Math.min(examples.length, 2),
    md: Math.min(examples.length, 4),
  };
  return (
    <VStack
      gap="x5"
      alignItems="center"
      width="full"
      maxWidth={720}
      minHeight={0}
      overflowY="auto"
    >
      <VStack gap="x1" alignItems="center">
        <Text as="h2" textStyle="title3">
          예시에서 시작해 보세요
        </Text>
        <Text textStyle="caption" color="fg.neutral-muted" align="center">
          고르면 토큰 없이 바로 캔버스에 올라와요. 마음에 드는 걸 고른 뒤
          문장으로 고쳐 나가면 됩니다.
        </Text>
      </VStack>
      <Grid
        columns={columns}
        gap="x3"
        width="full"
        maxWidth={{
          base: columns.base * CARD_WIDTH,
          md: columns.md * CARD_WIDTH,
        }}
      >
        {examples.map((example) => (
          <StarterCard
            key={example.id}
            example={example}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
      </Grid>
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
