import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "../cn";
import { CloseButton } from "./internal/close-button";
import { useControllableState } from "./internal/use-controllable-state";
import { useDialog } from "./internal/use-dialog";

const sizes = {
  small: "max-w-100", // 400px — 짧은 폼·확인성 콘텐츠
  medium: "max-w-140", // 560px — 필터·상세 폼 (기본)
};

export type ModalProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode; // t7 bold
  description?: ReactNode; // t5 muted
  footer?: ReactNode;
  size?: keyof typeof sizes;
  showCloseButton?: boolean;
  closeOnEscape?: boolean;
  "aria-label"?: string;
  children?: ReactNode;
};

/* 범용 중앙 모달 — AlertDialog와 달리 임의 콘텐츠를 담고 light-dismiss(바깥 클릭)로 닫힌다.
   모바일에서는 BottomSheet가 대응 쌍 — 자동 전환은 ResponsiveModal (overlay.md). */
export function Modal({
  open,
  defaultOpen = false,
  onOpenChange,
  title,
  description,
  footer,
  size = "medium",
  showCloseButton = true,
  closeOnEscape = true,
  "aria-label": ariaLabel,
  children,
}: ModalProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const { dialogProps } = useDialog({
    open: isOpen,
    onClose: () => setOpen(false),
    closeOnEscape,
    lightDismiss: true,
  });
  const id = useId();
  const titleId = title != null ? `${id}-title` : undefined;
  const descriptionId = description != null ? `${id}-description` : undefined;

  if (process.env.NODE_ENV !== "production" && title == null && !ariaLabel) {
    console.warn("Modal: title이 없으면 aria-label을 전달하세요.");
  }

  return (
    <dialog
      {...dialogProps}
      aria-label={ariaLabel}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        "m-auto w-full rounded-r5 border-0 bg-bg-layer-floating p-0 text-fg-neutral shadow-s3 outline-none",
        "transition duration-300 ease-enter",
        "starting:open:scale-95 starting:open:opacity-0",
        "data-closing:scale-95 data-closing:opacity-0 data-closing:duration-200 data-closing:ease-exit",
        "backdrop:bg-bg-overlay backdrop:transition-opacity backdrop:duration-300",
        "starting:open:backdrop:opacity-0 data-closing:backdrop:opacity-0",
        sizes[size],
      )}
    >
      <div className="flex max-h-full flex-col">
        <div className="flex items-start justify-between gap-x2 px-x6 pt-x6 pb-x4">
          <div className="flex min-w-0 flex-col gap-x1_5">
            {title != null && (
              <h2 id={titleId} className="text-t7 font-bold">
                {title}
              </h2>
            )}
            {description != null && (
              <div id={descriptionId} className="text-t5 text-fg-neutral-muted">
                {description}
              </div>
            )}
          </div>
          {showCloseButton && <CloseButton onClick={() => setOpen(false)} />}
        </div>
        {children != null && (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-x6 pb-x6">
            {children}
          </div>
        )}
        {footer != null && <div className="px-x6 pt-x2 pb-x6">{footer}</div>}
      </div>
    </dialog>
  );
}
