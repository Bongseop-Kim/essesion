import type { ComponentPropsWithRef, ReactNode } from "react";
import { createContext, use, useId } from "react";

import { cn } from "../cn";
import { SheetDialog, useSheetHandlers } from "./internal/sheet-dialog";
import { useControllableState } from "./internal/use-controllable-state";
import { VStack } from "./stack";
import { Text } from "./text";

const SwipeableMenuSheetContext = createContext<{ close: () => void } | null>(
  null,
);

export type SwipeableMenuSheetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  /** 하단 닫기 버튼 라벨 */
  closeLabel?: string;
  closeOnEscape?: boolean;
  "aria-label"?: string;
  children: ReactNode;
};

type ContentProps = {
  title?: ReactNode;
  description?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  titleId: string;
  descriptionId: string;
  children: ReactNode;
};

// SheetDialog 안에서 렌더돼야 useSheetHandlers(컨텍스트)를 소비할 수 있다.
function SwipeableMenuSheetContent({
  title,
  description,
  closeLabel,
  onClose,
  titleId,
  descriptionId,
  children,
}: ContentProps) {
  const { handleProps, contentProps } = useSheetHandlers();
  const hasHeader = title != null || description != null;

  return (
    <VStack {...contentProps} gap="x2_5" px="x4" pb="x4">
      {hasHeader ? (
        <VStack
          {...handleProps}
          align="center"
          gap="x1"
          pt="x1"
          pb="x2"
          className="touch-none text-center"
        >
          {title != null ? (
            <Text as="h2" id={titleId} textStyle="title3" color="fg.neutral">
              {title}
            </Text>
          ) : null}
          {description != null ? (
            <Text
              as="span"
              id={descriptionId}
              textStyle="bodySm"
              color="fg.neutral-subtle"
            >
              {description}
            </Text>
          ) : null}
        </VStack>
      ) : null}
      {children}
      <button
        type="button"
        onClick={onClose}
        className={cn(
          "min-h-13 w-full rounded-r3 bg-bg-neutral-weak text-t5 font-medium text-fg-neutral transition-colors duration-100 ease-standard",
          "hover:bg-bg-neutral-weak-hover active:bg-bg-neutral-weak-pressed",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
        )}
      >
        {closeLabel}
      </button>
    </VStack>
  );
}

/* 하단에서 올라오는 액션 목록 시트(공유·더보기 메뉴 등). 핸들·헤더 드래그나
   아래로 스와이프로 닫힌다. 항목은 SwipeableMenuSheetGroup으로 묶는다. */
export function SwipeableMenuSheet({
  open,
  defaultOpen = false,
  onOpenChange,
  title,
  description,
  closeLabel = "닫기",
  closeOnEscape = true,
  "aria-label": ariaLabel,
  children,
}: SwipeableMenuSheetProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const titleId = useId();
  const descriptionId = useId();
  const close = () => setOpen(false);

  return (
    <SwipeableMenuSheetContext value={{ close }}>
      <SheetDialog
        open={isOpen}
        onClose={close}
        closeOnEscape={closeOnEscape}
        radiusClass="rounded-t-r5"
        aria-label={title == null ? ariaLabel : undefined}
        labelledBy={title != null ? titleId : undefined}
        describedBy={description != null ? descriptionId : undefined}
      >
        <SwipeableMenuSheetContent
          title={title}
          description={description}
          closeLabel={closeLabel}
          onClose={close}
          titleId={titleId}
          descriptionId={descriptionId}
        >
          {children}
        </SwipeableMenuSheetContent>
      </SheetDialog>
    </SwipeableMenuSheetContext>
  );
}

export type SwipeableMenuSheetGroupProps = {
  children: ReactNode;
};

/** 항목 묶음 — 라운드로 감싸고 항목 사이를 얇은 구분선으로 나눈다. */
export function SwipeableMenuSheetGroup({
  children,
}: SwipeableMenuSheetGroupProps) {
  return (
    <VStack className="divide-y divide-stroke-neutral-weak overflow-hidden rounded-r4">
      {children}
    </VStack>
  );
}

export type SwipeableMenuSheetItemProps = Omit<
  ComponentPropsWithRef<"button">,
  "onSelect"
> & {
  tone?: "neutral" | "critical";
  labelAlign?: "left" | "center";
  icon?: ReactNode;
  onSelect?: () => void;
};

/** 액션 항목 — 선택 시 onSelect 후 시트를 닫는다(컨텍스트 밖이면 onSelect만). */
export function SwipeableMenuSheetItem({
  tone = "neutral",
  labelAlign = "left",
  icon,
  onSelect,
  className,
  type = "button",
  onClick,
  children,
  ...props
}: SwipeableMenuSheetItemProps) {
  const ctx = use(SwipeableMenuSheetContext);

  return (
    <button
      type={type}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onSelect?.();
        ctx?.close();
      }}
      className={cn(
        "flex min-h-13 w-full items-center gap-x2 bg-bg-neutral-weak px-x4 text-left text-t5 text-fg-neutral outline-none transition-colors duration-100 ease-standard",
        "hover:bg-bg-neutral-weak-hover active:bg-bg-neutral-weak-pressed focus-visible:bg-bg-neutral-weak-hover",
        "disabled:text-fg-disabled",
        tone === "critical" && "text-fg-critical",
        labelAlign === "center" && "justify-center text-center",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
