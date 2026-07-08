import { type ReactNode, type TouchEvent, useRef, useState } from "react";

import { Box } from "./box";
import { Flex } from "./flex";
import { ProgressCircle } from "./progress-circle";

export type PullToRefreshProps = {
  onRefresh: () => Promise<void>;
  /** 새로고침 트리거 임계값(px) */
  threshold?: number;
  children: ReactNode;
  className?: string;
};

/* ponytail: 터치 전용 미니 구현(감쇠 0.5, 스프링 없음) — 데스크톱은 no-op.
   물리 스프링·회전 화살표가 필요해지면 motion 라이브러리로 승격. */
export function PullToRefresh({
  onRefresh,
  threshold = 44,
  children,
  className,
}: PullToRefreshProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startY = useRef<number | null>(null);
  const [displacement, setDisplacement] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);

  function handleTouchStart(e: TouchEvent) {
    if (refreshing || (scrollRef.current?.scrollTop ?? 0) > 0) return;
    startY.current = e.touches[0]?.clientY ?? null;
    setDragging(true);
  }

  function handleTouchMove(e: TouchEvent) {
    if (startY.current === null || refreshing) return;
    const currentY = e.touches[0]?.clientY ?? startY.current;
    const delta = (currentY - startY.current) * 0.5;
    setDisplacement(Math.max(0, delta));
  }

  async function handleTouchEnd() {
    setDragging(false);
    const shouldRefresh = displacement >= threshold;
    startY.current = null;
    if (!shouldRefresh) {
      setDisplacement(0);
      return;
    }
    setDisplacement(threshold);
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      // ponytail: refresh owner handles errors; this component only resets drag state.
    } finally {
      setRefreshing(false);
      setDisplacement(0);
    }
  }

  const settleTransition = dragging
    ? undefined
    : "transform var(--duration-normal) var(--ease-standard)";

  return (
    <Box
      position="relative"
      overflow="hidden"
      className={className}
      style={{ overscrollBehaviorY: "contain" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <Flex
        aria-hidden={displacement === 0}
        position="absolute"
        top={0}
        left={0}
        right={0}
        justify="center"
        className="pointer-events-none"
        style={{
          transform: `translateY(${displacement - 40}px)`,
          opacity: Math.min(1, displacement / threshold),
          transition: settleTransition,
        }}
      >
        <ProgressCircle
          size={24}
          value={refreshing ? undefined : Math.min(1, displacement / threshold)}
        />
      </Flex>
      <Box
        ref={scrollRef}
        height="full"
        overflowY="auto"
        style={{
          transform: `translateY(${displacement}px)`,
          transition: settleTransition,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
