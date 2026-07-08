import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "../cn";
import { CloseButton } from "./internal/close-button";
import { useControllableState } from "./internal/use-controllable-state";
import { useDialog } from "./internal/use-dialog";

export type SidePanelProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: "small" | "medium" | "large";
  side?: "left" | "right";
  footer?: ReactNode;
  children: ReactNode;
  /** title이 없을 때 접근 이름을 위해 전달 (dialog에 패스스루) */
  "aria-label"?: string;
};

const sides = {
  right: "ml-auto starting:open:translate-x-full data-closing:translate-x-full",
  left: "mr-auto starting:open:-translate-x-full data-closing:-translate-x-full",
};

const panelSizes = {
  small: "md:max-w-120",
  medium: "md:max-w-180",
  large: "md:max-w-240",
};

/* 화면 가장자리에서 슬라이드하는 시트. 네이티브 <dialog>+showModal 기반이며
   백드롭 클릭으로 닫힌다(lightDismiss: true). display 클래스는 dialog가 아니라
   내부 래퍼에 둔다 — dialog:not([open])의 display:none을 덮으면 항상 보이게 됨. */
export function SidePanel({
  open,
  defaultOpen = false,
  onOpenChange,
  title,
  description,
  size = "small",
  side = "right",
  footer,
  children,
  "aria-label": ariaLabel,
}: SidePanelProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const { dialogProps } = useDialog({
    open: isOpen,
    onClose: () => setOpen(false),
    lightDismiss: true,
  });

  const titleId = useId();
  const descId = useId();

  if (process.env.NODE_ENV !== "production" && !title && !ariaLabel) {
    console.warn(
      "SidePanel: title이 없으면 aria-label을 전달하세요 (접근 이름 필요).",
    );
  }

  return (
    <dialog
      {...dialogProps}
      aria-label={title ? undefined : ariaLabel}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descId : undefined}
      className={cn(
        "m-0 h-dvh max-h-none w-4/5 border-0 bg-bg-layer-floating p-0 text-fg-neutral shadow-s3 outline-none transition duration-300 ease-enter data-closing:duration-200 data-closing:ease-exit backdrop:bg-bg-overlay backdrop:transition-opacity backdrop:duration-300 starting:open:backdrop:opacity-0 data-closing:backdrop:opacity-0",
        sides[side],
        panelSizes[size],
      )}
    >
      <div className="h-full flex flex-col">
        <div className="min-h-17.5 px-x6 pt-x6 pb-x4 flex items-start justify-between gap-x2">
          <div className="flex flex-col gap-x1_5">
            {title ? (
              <h2 id={titleId} className="text-t8 font-bold">
                {title}
              </h2>
            ) : null}
            {description ? (
              <div id={descId} className="text-t5 text-fg-neutral-muted">
                {description}
              </div>
            ) : null}
          </div>
          <CloseButton onClick={() => setOpen(false)} />
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-x6 pb-x12">
          {children}
        </div>
        {footer ? <div className="px-x6 py-x4">{footer}</div> : null}
      </div>
    </dialog>
  );
}
