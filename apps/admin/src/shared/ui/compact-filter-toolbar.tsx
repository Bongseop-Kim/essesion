import {
  ActionButton,
  Box,
  Flex,
  HStack,
  Icon,
  ResponsiveModal,
  SidePanel,
  useBreakpoint,
} from "@essesion/shared";
import { FunnelIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { useState } from "react";

export type CompactFilterToolbarProps = {
  primaryControls?: ReactNode;
  secondaryFilters?: ReactNode;
  secondaryFilterCount?: number;
  secondaryTitle?: ReactNode;
  secondaryDescription?: ReactNode;
  onOpenSecondaryFilters?: () => void;
  /** false를 반환하면 유효성 오류를 고칠 수 있도록 패널을 유지한다. */
  onApplySecondaryFilters?: () => false | undefined;
  onCancelSecondaryFilters?: () => void;
};

/** 목록 카드 안에 두는 핵심 필터 행. 보조 필터의 초안 상태는 소비자가 소유한다. */
export function CompactFilterToolbar({
  primaryControls,
  secondaryFilters,
  secondaryFilterCount = 0,
  secondaryTitle = "상세 필터",
  secondaryDescription,
  onOpenSecondaryFilters,
  onApplySecondaryFilters,
  onCancelSecondaryFilters,
}: CompactFilterToolbarProps) {
  const [isOpen, setOpen] = useState(false);
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint !== "base" && breakpoint !== "sm";
  const hasPrimaryControls = primaryControls != null;

  const openFilters = () => {
    onOpenSecondaryFilters?.();
    setOpen(true);
  };
  const cancelFilters = () => {
    onCancelSecondaryFilters?.();
    setOpen(false);
  };
  const applyFilters = () => {
    if (onApplySecondaryFilters?.() === false) return;
    setOpen(false);
  };
  const filterButtonLabel =
    secondaryFilterCount > 0 ? `필터 ${secondaryFilterCount}` : "필터";
  const footer = (
    <HStack justify="flex-end" gap="x2">
      <ActionButton variant="neutralOutline" onClick={cancelFilters}>
        취소
      </ActionButton>
      <ActionButton onClick={applyFilters}>필터 적용</ActionButton>
    </HStack>
  );
  const overlayProps = {
    open: isOpen,
    onOpenChange: (open: boolean) => {
      if (!open) cancelFilters();
    },
    title: secondaryTitle,
    description: secondaryDescription,
    footer,
  };

  return (
    <>
      <Flex
        as="section"
        aria-label="목록 필터"
        direction="row"
        align="flex-end"
        justify={hasPrimaryControls ? "flex-start" : "center"}
        wrap="wrap"
        gap="x2"
      >
        {hasPrimaryControls ? (
          <Box minWidth={0} maxWidth="full" flex={1}>
            {primaryControls}
          </Box>
        ) : null}
        {secondaryFilters != null ? (
          <Box flexShrink={0}>
            <ActionButton
              variant="neutralOutline"
              size="medium"
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              onClick={openFilters}
            >
              <Icon svg={<FunnelIcon />} size={18} />
              {filterButtonLabel}
            </ActionButton>
          </Box>
        ) : null}
      </Flex>

      {secondaryFilters != null ? (
        isDesktop ? (
          <SidePanel {...overlayProps} size="small">
            {secondaryFilters}
          </SidePanel>
        ) : (
          <ResponsiveModal {...overlayProps} showCloseButton>
            {secondaryFilters}
          </ResponsiveModal>
        )
      ) : null}
    </>
  );
}
