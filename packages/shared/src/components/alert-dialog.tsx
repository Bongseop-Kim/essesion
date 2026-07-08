import type { MouseEvent, ReactNode } from "react";
import { useId } from "react";

import { cn } from "../cn";
import { ActionButton, type ActionButtonProps } from "./action-button";
import { useControllableState } from "./internal/use-controllable-state";
import { useDialog } from "./internal/use-dialog";

export type AlertDialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  primaryActionProps: ActionButtonProps;
  secondaryActionProps?: ActionButtonProps;
  actionLayout?: "row" | "column";
  closeOnEscape?: boolean;
};

/* 파괴적·중요 결정을 요구하는 모달. 네이티브 <dialog>+showModal 기반이며
   백드롭 클릭으로 닫히지 않는다(lightDismiss: false) — 명시적 선택만 허용. */
export function AlertDialog({
  open,
  defaultOpen = false,
  onOpenChange,
  title,
  description,
  primaryActionProps,
  secondaryActionProps,
  actionLayout = "row",
  closeOnEscape = true,
}: AlertDialogProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const { dialogProps } = useDialog({
    open: isOpen,
    onClose: () => setOpen(false),
    closeOnEscape,
    lightDismiss: false,
  });

  const titleId = useId();
  const descId = useId();

  const runAction =
    (actionProps: ActionButtonProps) =>
    (event: MouseEvent<HTMLButtonElement>) => {
      actionProps.onClick?.(event);
      if (!event.defaultPrevented) setOpen(false);
    };

  const renderAction = (
    actionProps: ActionButtonProps,
    defaultVariant: ActionButtonProps["variant"],
    extraClassName?: string,
  ) => (
    <ActionButton
      variant={defaultVariant}
      size="medium"
      {...actionProps}
      className={cn(extraClassName, actionProps.className)}
      onClick={runAction(actionProps)}
    />
  );

  const isColumn = actionLayout === "column";

  return (
    <dialog
      {...dialogProps}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className="m-auto w-full max-w-68 rounded-r5 border-0 bg-bg-layer-floating p-0 text-fg-neutral shadow-s3 outline-none transition duration-300 ease-enter starting:open:scale-130 starting:open:opacity-0 data-closing:scale-130 data-closing:opacity-0 data-closing:duration-200 data-closing:ease-exit backdrop:bg-bg-overlay backdrop:transition-opacity backdrop:duration-300 starting:open:backdrop:opacity-0 data-closing:backdrop:opacity-0"
    >
      <div className="px-x5 pt-x5 flex flex-col gap-x1_5">
        <h2 id={titleId} className="text-t7 font-bold">
          {title}
        </h2>
        {description ? (
          <div
            id={descId}
            className="text-t5 whitespace-pre-wrap text-fg-neutral-muted"
          >
            {description}
          </div>
        ) : null}
      </div>
      <div
        className={cn("px-x5 pt-x4 pb-x5 flex gap-x2", isColumn && "flex-col")}
      >
        {isColumn ? (
          <>
            {renderAction(primaryActionProps, "brandSolid")}
            {secondaryActionProps
              ? renderAction(secondaryActionProps, "neutralWeak")
              : null}
          </>
        ) : (
          <>
            {secondaryActionProps
              ? renderAction(secondaryActionProps, "neutralWeak", "flex-1")
              : null}
            {renderAction(primaryActionProps, "brandSolid", "flex-1")}
          </>
        )}
      </div>
    </dialog>
  );
}
