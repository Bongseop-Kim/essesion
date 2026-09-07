import { ActionButton, Box, HStack, Text, VStack } from "@essesion/shared";
import {
  type CSSProperties,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  COACH_STEPS,
  type CoachStep,
  findCoachTarget,
} from "@/features/design/model/coach-steps";

export type CoachMarkProps = {
  open: boolean;
  /** 건너뛰기·완료·Esc 모두 여기로 — 호출자가 "봤음"을 기록한다. */
  onClose: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

const SPOT_PAD = 6;
const BUBBLE_WIDTH = 280;
const GAP = 14;
const EDGE = 12;

/**
 * 첫 진입 코치마크 — 화면의 실제 버튼·패널을 스포트라이트로 비추며 순서대로 설명한다.
 * 타깃은 `data-coach` 속성으로 찾고 위치는 getBoundingClientRect로 잰다. 딤 아래 클릭은 막는다.
 * ponytail: rect 측정 방식. CSS anchor positioning으로 옮길 이유는 스텝이 스크롤 컨테이너 안으로 들어갈 때뿐.
 */
export function CoachMark({ open, onClose }: CoachMarkProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const [steps, setSteps] = useState<readonly CoachStep[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(
    null,
  );
  const bubbleRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // 부모가 매 렌더 새 함수를 넘겨도 effect가 스텝을 초기화하지 않도록 ref로 든다.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const finish = () => {
    onCloseRef.current();
    returnFocus.current?.focus();
  };

  // 열릴 때 보이는 스텝만 모은다. 하나도 없으면 바로 끝.
  useLayoutEffect(() => {
    if (!open) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const visible = COACH_STEPS.filter((step) => findCoachTarget(step.key));
    setSteps(visible);
    setIndex(0);
    setRect(null);
    setBubble(null);
    if (visible.length === 0) onCloseRef.current();
  }, [open]);

  const step = open ? steps[index] : undefined;
  const last = index === steps.length - 1;

  // 현재 스텝의 타깃을 잰다. 사이에 사라졌으면 건너뛰고, 끝을 넘으면 닫는다.
  useLayoutEffect(() => {
    if (!open || steps.length === 0) return;
    const current = steps[index];
    if (!current) {
      onCloseRef.current();
      return;
    }
    const measure = () => {
      const el = findCoachTarget(current.key);
      if (!el) {
        setIndex((current) => current + 1);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, steps, index]);

  // 말풍선: 타깃 아래 우선, 아래가 모자라면 위. 좌우는 뷰포트 안으로.
  useLayoutEffect(() => {
    if (!rect) return;
    const height = bubbleRef.current?.offsetHeight ?? 0;
    const below =
      rect.top + rect.height + GAP + height <= window.innerHeight - EDGE;
    const top = below
      ? rect.top + rect.height + GAP
      : Math.max(EDGE, rect.top - GAP - height);
    const centered = rect.left + rect.width / 2 - BUBBLE_WIDTH / 2;
    const left = Math.max(
      EDGE,
      Math.min(window.innerWidth - BUBBLE_WIDTH - EDGE, centered),
    );
    setBubble({ top, left });
    nextRef.current?.focus();
  }, [rect]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  if (!open || !step || !rect) return null;

  const spotStyle: CSSProperties = {
    top: rect.top - SPOT_PAD,
    left: rect.left - SPOT_PAD,
    width: rect.width + SPOT_PAD * 2,
    height: rect.height + SPOT_PAD * 2,
    pointerEvents: "none",
  };
  const bubbleStyle: CSSProperties = {
    top: bubble?.top ?? rect.top + rect.height + GAP,
    left: bubble?.left ?? rect.left,
  };
  const ghostOnInverted =
    "text-fg-contrast hover:bg-bg-neutral-inverted active:bg-bg-neutral-inverted";

  return (
    <>
      {/* 딤 아래 클릭 차단 — 스포트라이트 박스는 그림만 그리고 클릭은 여기서 먹는다. */}
      <Box position="fixed" zIndex={40} style={{ inset: 0 }} aria-hidden />
      <Box
        position="fixed"
        zIndex={41}
        borderRadius="r3"
        className="coach-spot"
        style={spotStyle}
        aria-hidden
      />
      <VStack
        ref={bubbleRef}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        position="fixed"
        zIndex={42}
        width={BUBBLE_WIDTH}
        alignItems="stretch"
        gap="x2"
        px="x4"
        py="x3_5"
        bg="bg.neutral-inverted"
        borderRadius="r3"
        boxShadow="s2"
        style={bubbleStyle}
      >
        <Text textStyle="captionSm" color="fg.contrast" className="opacity-60">
          {`${index + 1} / ${steps.length}`}
        </Text>
        <Text id={titleId} as="h2" textStyle="labelSm" color="fg.contrast">
          {step.title}
        </Text>
        <Text
          id={descriptionId}
          textStyle="caption"
          color="fg.contrast"
          className="break-keep opacity-85"
        >
          {step.description}
        </Text>
        <HStack gap="x1" pt="x1">
          <HStack gap="x1" flex={1} aria-label="진행 상태">
            {steps.map((item, i) => (
              <Box
                key={item.key}
                width={i === index ? "x3_5" : "x1_5"}
                height="x1_5"
                borderRadius="full"
                bg={
                  i === index ? "bg.layer-default" : "bg.neutral-weak-pressed"
                }
                aria-current={i === index ? "step" : undefined}
              />
            ))}
          </HStack>
          <ActionButton
            variant="ghost"
            size="xsmall"
            className={ghostOnInverted}
            onClick={finish}
          >
            건너뛰기
          </ActionButton>
          {index > 0 ? (
            <ActionButton
              variant="ghost"
              size="xsmall"
              className={ghostOnInverted}
              onClick={() => setIndex((current) => current - 1)}
            >
              이전
            </ActionButton>
          ) : null}
          <ActionButton
            ref={nextRef}
            variant="neutralWeak"
            size="xsmall"
            onClick={last ? finish : () => setIndex((current) => current + 1)}
          >
            {last ? "완료" : "다음"}
          </ActionButton>
        </HStack>
      </VStack>
    </>
  );
}
