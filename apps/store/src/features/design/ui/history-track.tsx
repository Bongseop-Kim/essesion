import {
  Box,
  Flex,
  HStack,
  Icon,
  ScrollFog,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { type Ref, useEffect, useRef } from "react";

import type { DesignHistoryCell } from "@/features/design/model/steps";
import { svgToDataUri } from "@/features/design/model/svg-preview";

export type HistoryTrackProps = {
  cells: readonly DesignHistoryCell[];
  /** 편집 포인터 — 이 런의 칸에 `현재` 링이 붙는다 */
  currentRunId: string | null;
  /** 적용 중 — 이력 끝에 스켈레톤 칸 1개를 붙인다 */
  pending?: boolean;
  disabled?: boolean;
  onSelect: (runId: string) => void;
};

const SIZE = { base: 44, md: 64 } as const;

/** 하단 편집 이력 트랙. 썸네일 클릭이 되돌리기의 유일한 경로다(별도 버튼 없음). */
export function HistoryTrack({
  cells,
  currentRunId,
  pending = false,
  disabled = false,
  onSelect,
}: HistoryTrackProps) {
  const currentRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [currentRunId, cells.length, pending]);

  if (cells.length === 0 && !pending) return null;

  return (
    <ScrollFog
      direction="horizontal"
      aria-label="편집 이력"
      className="max-w-full"
    >
      <HStack
        gap="x2"
        alignItems="flex-start"
        className="min-w-max px-x1 py-x1"
      >
        {cells.map((cell) =>
          cell.kind === "failed" ? (
            <FailedCell key={`failed-${cell.seq}`} />
          ) : (
            <StepCell
              key={cell.runId}
              label={cell.label}
              current={cell.runId === currentRunId}
              disabled={disabled}
              svg={cell.svg}
              onSelect={() => onSelect(cell.runId)}
              ref={cell.runId === currentRunId ? currentRef : undefined}
            />
          ),
        )}
        {pending ? <PendingCell /> : null}
      </HStack>
    </ScrollFog>
  );
}

function StepCell({
  label,
  current,
  disabled,
  svg,
  onSelect,
  ref,
}: {
  label: number;
  current: boolean;
  disabled: boolean;
  svg: string;
  onSelect: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <VStack
      as="button"
      type="button"
      ref={ref}
      alignItems="center"
      gap="x1"
      onClick={onSelect}
      disabled={disabled || current}
      aria-current={current ? "step" : undefined}
      aria-label={
        current
          ? `${label}번째 디자인, 현재 편집 중`
          : `${label}번째 디자인으로 되돌리기`
      }
      className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none"
    >
      <Box
        width={SIZE}
        height={SIZE}
        borderRadius="r2"
        borderWidth={current ? 2 : 1}
        borderColor={current ? "stroke.brand" : "stroke.neutral"}
        boxShadow="s1"
        style={{
          backgroundImage: `url(${JSON.stringify(svgToDataUri(svg))})`,
          backgroundRepeat: "repeat",
          backgroundSize: "62% auto",
          backgroundPosition: "center",
        }}
      />
      <Text
        textStyle="captionSm"
        color={current ? "fg.neutral" : "fg.neutral-subtle"}
      >
        {current ? `${label} · 현재` : label}
      </Text>
    </VStack>
  );
}

function FailedCell() {
  return (
    <VStack alignItems="center" gap="x1">
      <Flex
        alignItems="center"
        justifyContent="center"
        width={SIZE}
        height={SIZE}
        borderRadius="r2"
        bg="bg.critical-weak"
        className="border border-dashed border-stroke-critical"
      >
        <Icon
          svg={<ExclamationTriangleIcon />}
          size={18}
          color="fg.critical"
          aria-label="실패한 요청"
        />
      </Flex>
      <Text textStyle="captionSm" color="fg.critical">
        실패
      </Text>
    </VStack>
  );
}

function PendingCell() {
  return (
    <VStack alignItems="center" gap="x1">
      <Box width={SIZE} height={SIZE}>
        <Skeleton width="full" height="full" radius="r2" />
      </Box>
      <Text textStyle="captionSm" color="fg.neutral-subtle">
        적용 중
      </Text>
    </VStack>
  );
}
