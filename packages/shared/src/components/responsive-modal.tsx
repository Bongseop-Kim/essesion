import type { ReactNode } from "react";

import { useBreakpoint } from "../breakpoint";
import { BottomSheet } from "./bottom-sheet";
import { useControllableState } from "./internal/use-controllable-state";
import { Modal, type ModalProps } from "./modal";

export type ResponsiveModalProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  showCloseButton?: boolean;
  closeOnEscape?: boolean;
  /** md 이상에서 Modal 크기 — 시트에는 영향 없음 */
  size?: ModalProps["size"];
  "aria-label"?: string;
  children: ReactNode;
};

/* 반응형 오버레이 쌍 — md(768px) 미만은 BottomSheet, 이상은 중앙 Modal.
   열림 상태를 여기서 소유해 열려 있는 동안 브레이크포인트를 넘어도 상태가 유지된다. */
export function ResponsiveModal({
  open,
  defaultOpen = false,
  onOpenChange,
  size,
  ...shared
}: ResponsiveModalProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const bp = useBreakpoint();
  const isDesktop = bp !== "base" && bp !== "sm";

  return isDesktop ? (
    <Modal open={isOpen} onOpenChange={setOpen} size={size} {...shared} />
  ) : (
    <BottomSheet open={isOpen} onOpenChange={setOpen} {...shared} />
  );
}
