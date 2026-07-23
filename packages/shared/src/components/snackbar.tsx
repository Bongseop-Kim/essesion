import type { ReactElement, ReactNode, Ref } from "react";
import {
  cloneElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { cn } from "../cn";
import { focusRing } from "./internal/focus-ring";
import { assignRef } from "./internal/merge-refs";
import type { SnackbarAction } from "./internal/snackbar-store";
import {
  advance,
  dismiss,
  enqueue,
  getSnapshot,
  registerAvoidOverlap,
  subscribe,
  unregisterAvoidOverlap,
  updateAvoidOverlap,
} from "./internal/snackbar-store";

export type { SnackbarAction } from "./internal/snackbar-store";

const EXIT_MS = 150;

/** 스낵바를 띄운다. current가 있으면 큐에 대기. 부여한 id 반환. */
export function snackbar(
  message: string,
  options?: { action?: SnackbarAction; duration?: number },
): number {
  return enqueue(message, options);
}
snackbar.dismiss = dismiss;

export type SnackbarAvoidOverlapProps = {
  children: ReactElement<{ ref?: Ref<HTMLElement> }>;
};

/** 스낵바가 겹치지 않아야 하는 하단 고정 영역을 등록한다. */
export function SnackbarAvoidOverlap({
  children,
}: SnackbarAvoidOverlapProps): ReactNode {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const childRef = children.props.ref;
  const setMeasuredNode = useCallback(
    (next: HTMLElement | null) => {
      setNode(next);
      assignRef(childRef, next);
    },
    [childRef],
  );

  useLayoutEffect(() => {
    if (!node) return;
    const id = registerAvoidOverlap();

    const update = () => {
      updateAvoidOverlap(id, node.getBoundingClientRect().height);
    };
    update();

    if (typeof ResizeObserver === "undefined") {
      return () => {
        unregisterAvoidOverlap(id);
      };
    }

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
      unregisterAvoidOverlap(id);
    };
  }, [node]);

  return cloneElement(children, { ref: setMeasuredNode });
}

/** 앱 루트에 1회 마운트하는 스낵바 표시 영역. store를 구독해 current 하나만 렌더. */
export function SnackbarHost(): ReactNode {
  const { current, avoidBottom } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const advanceTimerRef = useRef<number | undefined>(undefined);
  const remainingRef = useRef(0);
  const startedAtRef = useRef(0);
  const [closingId, setClosingId] = useState<number | null>(null);

  // popover 표시 동기화 — current가 바뀌면 hide→show로 재승격(entrance 리플레이).
  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    if (current === null) {
      try {
        el.hidePopover();
      } catch {
        // 이미 닫혀 있음
      }
      return;
    }
    try {
      el.hidePopover();
    } catch {
      // 이미 닫힘 — 무시
    }
    try {
      el.showPopover();
    } catch {
      // 이미 열림 — 무시
    }
  }, [current]);

  // duration 카운트다운을 시작한다. 만료 → data-closing 부여 → EXIT_MS 후 advance.
  const startCountdown = useCallback((id: number, ms: number) => {
    startedAtRef.current = Date.now();
    remainingRef.current = ms;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      setClosingId(id);
      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = undefined;
        advance();
      }, EXIT_MS);
    }, ms);
  }, []);

  // current(id)가 바뀔 때마다 타이머를 새로 시작하고, 언마운트/교체 시 정리.
  useEffect(() => {
    if (!current) return;
    startCountdown(current.id, current.duration);
    return () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = undefined;
      }
      if (advanceTimerRef.current !== undefined) {
        window.clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = undefined;
      }
    };
  }, [current, startCountdown]);

  // hover/focus 동안 잔여시간을 보존하고, 벗어나면 재시작(pause/resume).
  function pause() {
    if (closeTimerRef.current === undefined) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
    remainingRef.current -= Date.now() - startedAtRef.current;
  }
  function resume() {
    if (!current) return;
    if (closeTimerRef.current !== undefined) return;
    if (advanceTimerRef.current !== undefined) return;
    if (remainingRef.current <= 0) return;
    startCountdown(current.id, remainingRef.current);
  }

  const closing = current !== null && closingId === current.id;

  return (
    <div
      ref={popoverRef}
      popover="manual"
      role="status"
      // 잔여시간 보존은 스낵바 영역 전체(액션 버튼 포커스 포함)에서 pause/resume.
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      // 위치·리셋만 — display 클래스 금지(UA의 [popover] display:none을 덮어써 항상 열림).
      className="fixed inset-x-0 top-auto m-0 mx-auto w-fit border-0 bg-transparent p-0"
      style={{
        bottom: `calc(${avoidBottom}px + var(--spacing-x4) + env(safe-area-inset-bottom, 0px))`,
      }}
    >
      {current && (
        <div
          data-closing={closing || undefined}
          className={cn(
            "flex min-h-11 max-w-140 items-center gap-x3 rounded-r2 bg-bg-brand-solid px-x4 py-x2_5 text-t4 text-fg-contrast shadow-s2 transition duration-(--duration-normal) ease-enter",
            closing
              ? "scale-80 opacity-0 duration-(--duration-fast) ease-exit"
              : "starting:scale-80 starting:opacity-0",
          )}
        >
          <span className="min-w-0 flex-1">{current.message}</span>
          {current.action && (
            <button
              type="button"
              onClick={() => {
                current.action?.onClick();
                dismiss(current.id);
              }}
              className={cn(
                "shrink-0 font-bold text-fg-contrast text-t4 underline underline-offset-2",
                focusRing,
                "active:opacity-70",
              )}
            >
              {current.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
