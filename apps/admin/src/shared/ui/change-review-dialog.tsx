import { AlertDialog, Text, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

export type ChangeReviewItem = {
  label: string;
  before: ReactNode;
  after: ReactNode;
};

type ChangeReviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  items: readonly ChangeReviewItem[];
  reason: string;
  impact: string;
  confirmLabel: string;
  loading?: boolean;
  onConfirm: () => void;
};

/** 고위험 변경의 대상·전후 값·영향·사유를 확정 직전에 다시 보여준다. */
export function ChangeReviewDialog({
  open,
  onOpenChange,
  title,
  items,
  reason,
  impact,
  confirmLabel,
  loading = false,
  onConfirm,
}: ChangeReviewDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        <VStack gap="x3" alignItems="stretch">
          <VStack as="ul" gap="x2" alignItems="stretch">
            {items.map((item) => (
              <Text as="li" key={item.label} textStyle="bodySm">
                {item.label}: {item.before} → {item.after}
              </Text>
            ))}
          </VStack>
          <VStack gap="x1" alignItems="stretch">
            <Text textStyle="labelSm">영향 범위</Text>
            <Text textStyle="bodySm">{impact}</Text>
          </VStack>
          <VStack gap="x1" alignItems="stretch">
            <Text textStyle="labelSm">변경 사유</Text>
            <Text textStyle="bodySm">{reason}</Text>
          </VStack>
        </VStack>
      }
      primaryActionProps={{
        children: confirmLabel,
        loading,
        disabled: loading,
        onClick: onConfirm,
      }}
      secondaryActionProps={{ children: "돌아가기", disabled: loading }}
    />
  );
}
