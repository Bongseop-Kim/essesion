import { ActionButton, Box, HStack, Icon, Text } from "@essesion/shared";
import { MinusIcon, PlusIcon } from "@heroicons/react/24/outline";

/** −/값/+ 수량 스테퍼 — 1 이상, `max` 지정 시 상한. */
export function QuantityStepper({
  quantity,
  max,
  disabled,
  onChange,
}: {
  quantity: number;
  max?: number;
  disabled?: boolean;
  onChange: (quantity: number) => void;
}) {
  return (
    <HStack gap="x2">
      <ActionButton
        type="button"
        variant="neutralOutline"
        size="xsmall"
        iconOnly
        aria-label="수량 줄이기"
        disabled={disabled || quantity <= 1}
        onClick={() => onChange(Math.max(1, quantity - 1))}
      >
        <Icon svg={<MinusIcon />} size={16} />
      </ActionButton>
      <Box minWidth="x12">
        <Text as="span" textStyle="label" align="center" display="block">
          {quantity}
        </Text>
      </Box>
      <ActionButton
        type="button"
        variant="neutralOutline"
        size="xsmall"
        iconOnly
        aria-label="수량 늘리기"
        disabled={disabled || (max !== undefined && quantity >= max)}
        onClick={() =>
          onChange(max ? Math.min(max, quantity + 1) : quantity + 1)
        }
      >
        <Icon svg={<PlusIcon />} size={16} />
      </ActionButton>
    </HStack>
  );
}
