import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "../cn";
import { Box } from "./box";
import { Flex } from "./flex";
import { CloseButton } from "./internal/close-button";
import { warnDev } from "./internal/dev-warn";
import { overlayBackdrop, overlaySurface } from "./internal/overlay-chrome";
import { useControllableState } from "./internal/use-controllable-state";
import { useDialog } from "./internal/use-dialog";
import { VStack } from "./stack";
import { Text } from "./text";

export type SidePanelProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** title이 없을 때 접근 이름을 위해 전달 (dialog에 패스스루) */
  "aria-label"?: string;
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

  warnDev(
    !title && !ariaLabel,
    "SidePanel: title이 없으면 aria-label을 전달하세요 (접근 이름 필요).",
  );

  return (
    <dialog
      {...dialogProps}
      aria-label={title ? undefined : ariaLabel}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descId : undefined}
      className={cn(
        "m-0 h-dvh max-h-none w-4/5",
        overlaySurface,
        "transition duration-(--duration-slow) ease-enter data-closing:duration-(--duration-normal) data-closing:ease-exit",
        overlayBackdrop,
        "ml-auto starting:open:translate-x-full data-closing:translate-x-full md:max-w-120",
      )}
    >
      <Flex direction="column" height="full">
        <Flex
          align="flex-start"
          justify="space-between"
          gap="x2"
          px="x6"
          pt="x6"
          pb="x4"
          className="min-h-17.5"
        >
          <VStack gap="x1_5">
            {title ? (
              <Text as="h2" id={titleId} textStyle="title2">
                {title}
              </Text>
            ) : null}
            {description ? (
              <Text
                as="div"
                id={descId}
                textStyle="body"
                color="fg.neutral-muted"
              >
                {description}
              </Text>
            ) : null}
          </VStack>
          <CloseButton onClick={() => setOpen(false)} />
        </Flex>
        <Box
          flex={1}
          overflowY="auto"
          px="x6"
          pb="x12"
          className="overscroll-contain"
        >
          {children}
        </Box>
        {footer ? (
          <Box px="x6" py="x4">
            {footer}
          </Box>
        ) : null}
      </Flex>
    </dialog>
  );
}
