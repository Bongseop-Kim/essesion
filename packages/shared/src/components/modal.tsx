import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "../cn";
import { Box } from "./box";
import { Flex } from "./flex";
import { CloseButton } from "./internal/close-button";
import { useControllableState } from "./internal/use-controllable-state";
import { useDialog } from "./internal/use-dialog";
import { VStack } from "./stack";
import { Text } from "./text";

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
        "m-auto w-full overflow-hidden rounded-r5 border-0 bg-bg-layer-floating p-0 text-fg-neutral shadow-s3 outline-none",
        "transition duration-300 ease-enter",
        "starting:open:scale-95 starting:open:opacity-0",
        "data-closing:scale-95 data-closing:opacity-0 data-closing:duration-200 data-closing:ease-exit",
        "backdrop:bg-bg-overlay backdrop:transition-opacity backdrop:duration-300",
        "starting:open:backdrop:opacity-0 data-closing:backdrop:opacity-0",
        sizes[size],
      )}
      // UA dialog max-height만으로는 자식의 100% 높이가 확정되지 않아 dialog가 스크롤된다.
      // dialog와 내부 flex를 같은 명시적 상한으로 묶어 콘텐츠 Box가 스크롤을 소유하게 한다.
      style={{ maxHeight: "var(--size-modal-max-height)" }}
    >
      <Flex direction="column" maxHeight="size.modal-max-height">
        <Flex
          align="flex-start"
          justify="space-between"
          gap="x2"
          px="x6"
          pt="x6"
          pb="x4"
        >
          <VStack minWidth={0} gap="x1_5">
            {title != null && (
              <Text as="h2" id={titleId} textStyle="title3">
                {title}
              </Text>
            )}
            {description != null && (
              <Text
                as="div"
                id={descriptionId}
                textStyle="body"
                color="fg.neutral-muted"
              >
                {description}
              </Text>
            )}
          </VStack>
          {showCloseButton && <CloseButton onClick={() => setOpen(false)} />}
        </Flex>
        {children != null && (
          <Box
            minHeight={0}
            flex={1}
            overflowY="auto"
            px="x6"
            pb="x6"
            className="overscroll-contain"
          >
            {children}
          </Box>
        )}
        {footer != null && (
          <Box px="x6" pt="x2" pb="x6">
            {footer}
          </Box>
        )}
      </Flex>
    </dialog>
  );
}
