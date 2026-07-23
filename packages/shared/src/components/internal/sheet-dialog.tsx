import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { createContext, use } from "react";

import { cn } from "../../cn";
import { Flex } from "../flex";
import { overlayBackdrop, overlaySurface } from "./overlay-chrome";
import { useDialog } from "./use-dialog";
import { useSheetDrag } from "./use-sheet-drag";

type SheetHandlers = {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
};

const SheetDragContext = createContext<{
  handleProps: SheetHandlers;
  contentProps: SheetHandlers;
} | null>(null);

/** 셸 안에서 드래그 핸들러 소비 — 헤더엔 handleProps, 스크롤 바디엔 contentProps. */
export function useSheetHandlers() {
  const ctx = use(SheetDragContext);
  if (ctx === null) {
    throw new Error(
      "useSheetHandlers는 <SheetDialog> 안에서만 사용할 수 있습니다.",
    );
  }
  return ctx;
}

export type SheetDialogProps = {
  open: boolean;
  onClose: () => void;
  closeOnEscape?: boolean;
  /** 상단 모서리 라운드. */
  radiusClass: string;
  labelledBy?: string;
  describedBy?: string;
  "aria-label"?: string;
  /** 핸들 아래 내부 콘텐츠 전체 */
  children: ReactNode;
};

// 화면 하단에 붙는 모달 <dialog>. 등장·닫힘은 CSS 클래스(starting/data-closing)가,
// 드래그 추적은 셸이 조건부로 얹는 inline transform이 담당한다.
// UA의 dialog max-size를 풀어 화면 전폭·전고 상한을 명시하고, 내부 콘텐츠가 스크롤을 소유한다.
const dialogClass = cn(
  "m-0 mt-auto mx-auto max-h-dvh w-full max-w-full overflow-hidden",
  overlaySurface,
  "transition duration-(--duration-slow) ease-enter",
  "starting:open:translate-y-full",
  "data-closing:translate-y-full data-closing:duration-(--duration-normal) data-closing:ease-exit",
  overlayBackdrop,
);

/* 시트 공용 셸. 네이티브 <dialog>+showModal 기반이며
   백드롭 클릭(lightDismiss)과 아래로 스와이프로 닫힌다. display 클래스는 dialog가
   아니라 내부 래퍼에 둔다 — dialog:not([open])의 display:none을 덮으면 항상 보이게 됨. */
export function SheetDialog({
  open,
  onClose,
  closeOnEscape = true,
  radiusClass,
  labelledBy,
  describedBy,
  "aria-label": ariaLabel,
  children,
}: SheetDialogProps) {
  const { dialogProps } = useDialog({
    open,
    onClose,
    closeOnEscape,
    lightDismiss: true,
  });
  const { engaged, sheetStyle, handleProps, contentProps } = useSheetDrag({
    enabled: open,
    onDismiss: onClose,
  });

  // 드래그가 개입한 동안만 inline transform으로 시트를 추적한다. 미개입 상태의
  // 등장·닫힘은 CSS 클래스에 맡겨 두 전환이 서로 덮어쓰지 않게 한다.
  const style: CSSProperties = {
    paddingBottom: "env(safe-area-inset-bottom, 0px)",
    ...(engaged ? sheetStyle : null),
  };

  return (
    <dialog
      {...dialogProps}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={cn(dialogClass, radiusClass)}
      style={style}
    >
      <Flex direction="column" className="max-h-dvh">
        <Flex
          {...handleProps}
          align="center"
          justify="center"
          className="min-h-11 shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
        >
          <span
            aria-hidden="true"
            className="h-1 w-9 rounded-full bg-stroke-neutral"
          />
        </Flex>
        <SheetDragContext value={{ handleProps, contentProps }}>
          {children}
        </SheetDragContext>
      </Flex>
    </dialog>
  );
}
