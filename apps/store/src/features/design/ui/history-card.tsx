import {
  ActionButton,
  Box,
  Flex,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";

import type { DesignStepCell } from "@/features/design/model/steps";
import { svgTileStyle } from "@/features/design/model/svg-preview";

export type HistoryCardProps = {
  /** 성공한 디자인 칸만 — 실패 칸은 번호를 차지하지 않아 스테퍼에 뜨지 않는다. */
  cells: readonly DesignStepCell[];
  /** `cells`에서 편집 포인터의 위치(없으면 -1) */
  currentIndex: number;
  /** 적용 중 — 썸네일을 스켈레톤으로 바꾸고 이동을 잠근다 */
  pending?: boolean;
  disabled?: boolean;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onSelect: (runId: string) => void;
  onOpenAll: () => void;
};

/**
 * 좌측 이력 카드 스테퍼. 현재 스텝 한 칸만 보여주고 ◀ ▶로 포인터를 옮긴다.
 * 전체 격자는 모달에 맡긴다 — 카드 안에는 스크롤이 없다.
 * 접힘은 모티프 카드와 같은 규칙: 제목 줄과 24px 미니 칩만 남는다.
 */
export function HistoryCard({
  cells,
  currentIndex,
  pending = false,
  disabled = false,
  collapsed,
  onCollapsedChange,
  onSelect,
  onOpenAll,
}: HistoryCardProps) {
  // 첫 진입(디자인 없음)엔 카드 자체가 없다. 첫 생성 중에는 스켈레톤으로 뜬다.
  if (cells.length === 0 && !pending) return null;

  const current = cells[currentIndex];
  const prev = cells[currentIndex - 1];
  const next = cells[currentIndex + 1];
  const locked = disabled || pending;
  const label = pending
    ? "적용 중"
    : !current
      ? ""
      : currentIndex === cells.length - 1
        ? "현재"
        : `${current.label}번째`;

  return (
    <VStack
      as="section"
      aria-label="편집 이력"
      alignItems="stretch"
      gap="x2"
      width={{ base: 84, md: 152 }}
      p={{ base: "x1_5", md: "x3" }}
      bg="bg.layer-floating"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      boxShadow="s1"
    >
      <HStack gap="x1_5" display={{ base: "none", md: "flex" }}>
        <Text as="h2" textStyle="labelSm">
          이력
        </Text>
        <Text
          textStyle="captionSm"
          color="fg.neutral-subtle"
          className="tabular-nums"
        >
          {current ? `${currentIndex + 1} / ${cells.length}` : null}
        </Text>
        <Box ml="auto">
          <ActionButton
            variant="ghost"
            size="xsmall"
            iconOnly
            aria-label={collapsed ? "이력 카드 펼치기" : "이력 카드 접기"}
            aria-expanded={!collapsed}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            <Icon
              svg={<ChevronDownIcon />}
              size={16}
              className={`transition-transform duration-100 ease-standard ${collapsed ? "-rotate-90" : ""}`}
            />
          </ActionButton>
        </Box>
      </HStack>

      {collapsed ? (
        <Box display={{ base: "none", md: "block" }}>
          <MiniChip svg={current && !pending ? current.svg : null} />
        </Box>
      ) : null}

      {/* base엔 제목 줄·미니 칩이 없으니 접힘 상태와 무관하게 스테퍼를 보여준다. */}
      <VStack
        alignItems="stretch"
        gap="x2"
        display={{ base: "flex", md: collapsed ? "none" : "flex" }}
      >
        {current && !pending ? (
          // base엔 `전체 보기` 줄이 없다 — 썸네일 자체가 모달 진입점을 겸한다.
          <Box
            as="button"
            type="button"
            width="full"
            borderRadius="r2"
            borderWidth={2}
            borderColor="stroke.brand"
            onClick={onOpenAll}
            disabled={disabled}
            aria-current="step"
            aria-label={`${current.label}번째 디자인 · 전체 이력 보기`}
            style={svgTileStyle(current.svg)}
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
          />
        ) : (
          <Skeleton width="100%" radius="r2" style={{ aspectRatio: 1 }} />
        )}

        <Flex
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          gap="x1"
        >
          <ActionButton
            variant="ghost"
            size="xsmall"
            iconOnly
            aria-label={
              prev ? `${prev.label}번째 디자인으로 되돌리기` : "이전 디자인"
            }
            disabled={locked || !prev}
            onClick={() => prev && onSelect(prev.runId)}
          >
            <Icon svg={<ChevronLeftIcon />} size={16} />
          </ActionButton>
          <Text
            textStyle="captionSm"
            color="fg.neutral-subtle"
            display={{ base: "none", md: "block" }}
          >
            {label}
          </Text>
          <ActionButton
            variant="ghost"
            size="xsmall"
            iconOnly
            aria-label={
              next ? `${next.label}번째 디자인으로 이동` : "다음 디자인"
            }
            disabled={locked || !next}
            onClick={() => next && onSelect(next.runId)}
          >
            <Icon svg={<ChevronRightIcon />} size={16} />
          </ActionButton>
        </Flex>

        <Box display={{ base: "none", md: "block" }}>
          <ActionButton
            variant="ghost"
            size="xsmall"
            disabled={locked}
            onClick={onOpenAll}
            className="w-full"
          >
            전체 보기
          </ActionButton>
        </Box>
      </VStack>
    </VStack>
  );
}

/** 접힘 상태의 24px 표시 전용 칩 — 모티프 카드와 같은 규칙(되돌리기는 펼친 뒤). */
function MiniChip({ svg }: { svg: string | null }) {
  return svg ? (
    <Box
      width={24}
      height={24}
      borderRadius="r2"
      borderWidth={1}
      borderColor="stroke.brand"
      style={svgTileStyle(svg)}
      aria-hidden="true"
    />
  ) : (
    <Skeleton width={24} height={24} radius="r2" />
  );
}
