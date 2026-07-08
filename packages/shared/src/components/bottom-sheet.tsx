import type { ReactNode } from "react";
import { useId } from "react";

import { Box } from "./box";
import { Flex } from "./flex";
import { CloseButton } from "./internal/close-button";
import { SheetDialog, useSheetHandlers } from "./internal/sheet-dialog";
import { useControllableState } from "./internal/use-controllable-state";
import { VStack } from "./stack";
import { Text } from "./text";

export type BottomSheetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  /** 우상단 닫기 버튼 — 중요 플로우에서 명시적 닫기 지점이 필요할 때 */
  showCloseButton?: boolean;
  closeOnEscape?: boolean;
  "aria-label"?: string;
  children: ReactNode;
};

type BodyProps = {
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  showCloseButton: boolean;
  onClose: () => void;
  titleId: string;
  descriptionId: string;
  children: ReactNode;
};

// SheetDialog 안에서 렌더돼야 useSheetHandlers(컨텍스트)를 소비할 수 있다.
function BottomSheetBody({
  title,
  description,
  footer,
  showCloseButton,
  onClose,
  titleId,
  descriptionId,
  children,
}: BodyProps) {
  const { handleProps, contentProps } = useSheetHandlers();
  const hasHeader = title != null || description != null || showCloseButton;

  return (
    <>
      {hasHeader ? (
        <Flex
          {...handleProps}
          align="flex-start"
          justify="space-between"
          gap="x2"
          px="x4"
          pt="x1"
          pb="x4"
          className="shrink-0 touch-none"
        >
          <VStack gap="x2">
            {title != null ? (
              <Text as="h2" id={titleId} textStyle="title2" color="fg.neutral">
                {title}
              </Text>
            ) : null}
            {description != null ? (
              <Text
                as="span"
                id={descriptionId}
                textStyle="body"
                color="fg.neutral-muted"
              >
                {description}
              </Text>
            ) : null}
          </VStack>
          {showCloseButton ? <CloseButton onClick={onClose} /> : null}
        </Flex>
      ) : null}
      <Box
        {...contentProps}
        minHeight={0}
        flex={1}
        overflowY="auto"
        px="x4"
        pb="x4"
        className="overscroll-contain"
      >
        {children}
      </Box>
      {footer != null ? (
        <Box className="shrink-0" px="x4" pt="x3" pb="x4">
          {footer}
        </Box>
      ) : null}
    </>
  );
}

/* 화면 하단에서 올라오는 시트. 핸들·헤더 드래그 또는 스크롤 최상단에서 아래로
   스와이프해 닫는다. 콘텐츠가 길면 바디가 스크롤된다. */
export function BottomSheet({
  open,
  defaultOpen = false,
  onOpenChange,
  title,
  description,
  footer,
  showCloseButton = false,
  closeOnEscape = true,
  "aria-label": ariaLabel,
  children,
}: BottomSheetProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const titleId = useId();
  const descriptionId = useId();
  const close = () => setOpen(false);

  return (
    <SheetDialog
      open={isOpen}
      onClose={close}
      closeOnEscape={closeOnEscape}
      radiusClass="rounded-t-r6"
      aria-label={title == null ? ariaLabel : undefined}
      labelledBy={title != null ? titleId : undefined}
      describedBy={description != null ? descriptionId : undefined}
    >
      <BottomSheetBody
        title={title}
        description={description}
        footer={footer}
        showCloseButton={showCloseButton}
        onClose={close}
        titleId={titleId}
        descriptionId={descriptionId}
      >
        {children}
      </BottomSheetBody>
    </SheetDialog>
  );
}
