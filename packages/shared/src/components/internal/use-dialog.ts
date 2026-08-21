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
    /** 진입 포커스를 패널 자신이 받도록 — 자동 포커스 링 방지(showModal 직후 focus) */
    tabIndex: number;
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
  const focusBeforeOpen = useRef<HTMLElement | null>(null);

  useEffect(
    () => () => {
      window.clearTimeout(closingTimer.current);
      const focusTarget = focusBeforeOpen.current;
      if (focusTarget?.isConnected) {
        queueMicrotask(() => focusTarget.focus());
      }
    },
    [],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      window.clearTimeout(closingTimer.current);
      dialog.removeAttribute("data-closing");
      if (!dialog.open) {
        focusBeforeOpen.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        // 스크롤 잠금 중 레이아웃 시프트는 theme.css의 scrollbar-gutter가 방지
        dialog.showModal();
        // showModal은 첫 포커서블(보통 닫기 버튼)을 자동 포커스하고 브라우저가 이를
        // :focus-visible로 취급해 파란 링을 그린다 — 마우스로 열었는데 링이 뜬다.
        // 포커스를 dialog 자신(tabIndex -1)으로 옮기면 링 없이 포커스 트랩은 유지되고,
        // 첫 Tab에서 정상적으로 내부 첫 요소에 링이 생긴다. autofocus 지정은 존중한다.
        if (!dialog.querySelector("[autofocus]")) dialog.focus();
      }
      return;
    }

    if (!dialog.open) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.close();
      focusBeforeOpen.current?.focus();
      return;
    }
    dialog.setAttribute("data-closing", "");
    closingTimer.current = window.setTimeout(() => {
      dialog.removeAttribute("data-closing");
      dialog.close();
      focusBeforeOpen.current?.focus();
    }, exitDuration + 50);
    return () => window.clearTimeout(closingTimer.current);
  }, [open, exitDuration]);

  return {
    dialogRef,
    dialogProps: {
      ref: dialogRef,
      tabIndex: -1,
      onCancel: (event) => {
        // <input type="file">의 선택 취소도 bubbles: true인 cancel을 올려보낸다 —
        // 내 dialog가 낸 것(ESC)만 닫힘으로 친다.
        if (event.target !== dialogRef.current) return;
        // 네이티브 즉시 close를 막고 자체 퇴장 파이프라인으로
        event.preventDefault();
        if (closeOnEscape) onClose();
      },
      onClose: () => {
        dialogRef.current?.removeAttribute("data-closing");
        focusBeforeOpen.current?.focus();
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
