import { ActionButton, Box, Text, VStack } from "@essesion/shared";

import { krw } from "@/shared/lib/format";

export function PaymentActionBar({
  amount,
  onClick,
  disabled,
  loading,
  helperText,
}: {
  amount: number;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  helperText?: string;
}) {
  return (
    <VStack gap="x2" alignItems="stretch">
      {helperText ? (
        <Text textStyle="caption" color="fg.neutral-muted" align="center">
          {helperText}
        </Text>
      ) : null}
      <Box
        as={ActionButton}
        type="button"
        size="large"
        width="full"
        disabled={disabled}
        loading={loading}
        onClick={onClick}
      >
        {krw.format(amount)}원 결제하기
      </Box>
    </VStack>
  );
}
