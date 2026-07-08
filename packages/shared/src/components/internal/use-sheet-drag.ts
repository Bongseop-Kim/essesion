import type { CSSProperties, PointerEvent } from "react";
import { useLayoutEffect, useRef, useState } from "react";

type Sample = { y: number; t: number };

const DISMISS_DISTANCE_RATIO = 0.25; // 시트 높이의 25% 이상 끌면 닫힘
const DISMISS_VELOCITY = 0.4; // px/ms — 짧게 끌어도 빠르면 닫힘

type SheetHandlers = {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
};

export type UseSheetDragReturn = {
  displacement: number;
  dragging: boolean;
  /** 이 열림 사이클에서 드래그가 시작됐는가 — 셸이 inline transform 적용 여부를 결정 */
  engaged: boolean;
  /** 핸들·헤더용 — 마우스·터치 모두 드래그 시작 */
  handleProps: SheetHandlers;
  /** 스크롤 바디용 — 터치 전용 + scrollTop===0일 때만(스크롤·텍스트 선택을 가로채지 않음) */
  contentProps: SheetHandlers;
  sheetStyle: CSSProperties;
};

/* 아래로 스와이프/드래그해 시트를 닫는 1:1 추적(감쇠 없음, 위로는 0 클램프).
   Pointer Events + setPointerCapture — 마우스와 터치 모두 동작.
   시트 높이는 이벤트 currentTarget에서 closest <dialog>의 offsetHeight로 계산. */
export function useSheetDrag({
  enabled,
  onDismiss,
}: {
  enabled: boolean;
  onDismiss: () => void;
}): UseSheetDragReturn {
  const [displacement, setDisplacement] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const startY = useRef<number | null>(null);
  const samples = useRef<Sample[]>([]);

  // 다시 열릴 때만 리셋 — 닫힘 전환은 현재 변위에서 이어지도록 유지한다.
  // paint 전(showModal 이전)에 리셋해 재등장 시 이전 변위가 한 프레임 보이는 것을 막는다.
  useLayoutEffect(() => {
    if (enabled) {
      setDisplacement(0);
      setDragging(false);
      setEngaged(false);
    }
  }, [enabled]);

  function begin(event: PointerEvent, contentArea: boolean) {
    if (!enabled) return;
    if (contentArea) {
      // 바디에서는 터치만, 그리고 최상단일 때만 — 마우스 드래그(텍스트 선택)·스크롤을 가로채지 않음
      if (event.pointerType !== "touch") return;
      if ((event.currentTarget as HTMLElement).scrollTop > 0) return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    startY.current = event.clientY;
    samples.current = [{ y: event.clientY, t: event.timeStamp }];
    setEngaged(true);
    setDragging(true);
  }

  function move(event: PointerEvent) {
    if (startY.current === null) return;
    setDisplacement(Math.max(0, event.clientY - startY.current));
    samples.current.push({ y: event.clientY, t: event.timeStamp });
    if (samples.current.length > 2) samples.current.shift();
  }

  function end(event: PointerEvent) {
    if (startY.current === null) return;
    startY.current = null;
    setDragging(false);

    const height =
      (event.currentTarget as HTMLElement).closest("dialog")?.offsetHeight ?? 0;
    const [prev, last] = samples.current;
    const velocity =
      prev && last && last.t !== prev.t
        ? (last.y - prev.y) / (last.t - prev.t)
        : 0;

    if (
      displacement > height * DISMISS_DISTANCE_RATIO ||
      velocity > DISMISS_VELOCITY
    ) {
      // 리셋하지 않고 현재 위치에서 완전히 아래로 이어서 슬라이드 아웃한다.
      setDisplacement(height);
      onDismiss();
    } else {
      setDisplacement(0); // 스프링백
    }
  }

  function cancel() {
    // 브라우저가 제스처를 가져간 경우(스크롤 등) — 닫지 않고 원위치
    if (startY.current === null) return;
    startY.current = null;
    setDragging(false);
    setDisplacement(0);
  }

  const handlers = (contentArea: boolean): SheetHandlers => ({
    onPointerDown: (event) => begin(event, contentArea),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: cancel,
  });

  const sheetStyle: CSSProperties = {
    transform: `translateY(${displacement}px)`,
    transition: dragging
      ? "none"
      : "transform var(--duration-normal) var(--ease-standard)",
  };

  return {
    displacement,
    dragging,
    engaged,
    handleProps: handlers(false),
    contentProps: handlers(true),
    sheetStyle,
  };
}
