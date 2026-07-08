import type {
  MouseEvent,
  PointerEvent,
  RefObject,
  SyntheticEvent,
} from "react";
import { useEffect, useRef } from "react";

export type UseDialogOptions = {
  open: boolean;
  /** 어떤 경로로든 닫힘이 발생·요청될 때 상태를 false로 동기화 */
  onClose: () => void;
  closeOnEscape?: boolean;
  /** 백드롭 클릭(light-dismiss) 허용 — AlertDialog는 false */
  lightDismiss?: boolean;
  /** data-closing 퇴장 전환 시간(ms) — 전환 클래스의 duration과 일치시킬 것 */
  exitDuration?: number;
};

export type UseDialogReturn = {
  dialogRef: RefObject<HTMLDialogElement | null>;
  dialogProps: {
    ref: RefObject<HTMLDialogElement | null>;
    onCancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
    onClose: () => void;
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => void;
    onClick: (event: MouseEvent<HTMLDialogElement>) => void;
  };
};

/* 네이티브 <dialog>+showModal의 controlled 동기화.
   - 등장: showModal + @starting-style(starting: variant)이 CSS에서 처리
   - 퇴장: data-closing 부여([open] 유지 → backdrop·top-layer 유지) 후 지연 close.
     순수 CSS 퇴장(overlay 속성 전환)은 Chromium 전용이라 채택하지 않음 (overlay.md)
   - onClose가 상태의 최종 진실 — Chrome CloseWatcher 연속 Esc 등 어떤 close에도 재동기화 */
export function useDialog({
  open,
  onClose,
  closeOnEscape = true,
  lightDismiss = false,
  exitDuration = 200,
}: UseDialogOptions): UseDialogReturn {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closingTimer = useRef<number | undefined>(undefined);
  const pointerDownOnBackdrop = useRef(false);
  const restoreBodyPadding = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      window.clearTimeout(closingTimer.current);
      dialog.removeAttribute("data-closing");
      if (!dialog.open) {
        // showModal 전에 측정·보상 — overflow:hidden(theme.css)으로 스크롤바가
        // 사라질 때 콘텐츠 폭이 출렁이는 레이아웃 시프트 방지.
        const scrollbarWidth =
          window.innerWidth - document.documentElement.clientWidth;
        const previousPaddingRight = document.body.style.paddingRight;
        restoreBodyPadding.current = () => {
          document.body.style.paddingRight = previousPaddingRight;
          restoreBodyPadding.current = undefined;
        };
        if (scrollbarWidth > 0) {
          document.body.style.paddingRight = `${scrollbarWidth}px`;
        }
        dialog.showModal();
      }
      return () => restoreBodyPadding.current?.();
    }

    if (!dialog.open) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.close();
      return;
    }
    dialog.setAttribute("data-closing", "");
    closingTimer.current = window.setTimeout(() => {
      dialog.removeAttribute("data-closing");
      dialog.close();
    }, exitDuration + 50);
    return () => window.clearTimeout(closingTimer.current);
  }, [open, exitDuration]);

  return {
    dialogRef,
    dialogProps: {
      ref: dialogRef,
      onCancel: (event) => {
        // 네이티브 즉시 close를 막고 자체 퇴장 파이프라인으로
        event.preventDefault();
        if (closeOnEscape) onClose();
      },
      onClose: () => {
        dialogRef.current?.removeAttribute("data-closing");
        // 스크롤바 보상 복원 — 어떤 경로의 close든 이 이벤트를 지나간다
        restoreBodyPadding.current?.();
        // 지연 close(이미 open=false)에서는 no-op, 강제 close에서는 재동기화
        if (open) onClose();
      },
      onPointerDown: (event) => {
        pointerDownOnBackdrop.current = event.target === dialogRef.current;
      },
      onClick: (event) => {
        if (
          lightDismiss &&
          pointerDownOnBackdrop.current &&
          event.target === dialogRef.current
        ) {
          onClose();
        }
        pointerDownOnBackdrop.current = false;
      },
    },
  };
}
