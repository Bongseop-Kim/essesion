import { ActionButton, Box, Icon, Text, VStack } from "@essesion/shared";
import { EnvelopeIcon } from "@heroicons/react/24/outline";

/** 견적서 메일 버튼 — 상품 상세의 찜 버튼과 같은 자리·크기(액션 바 1열). */
export function EstimateMailButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      as={ActionButton}
      type="button"
      variant="neutralWeak"
      size="large"
      iconOnly
      aria-label="견적서 메일로 받기"
      disabled={disabled}
      onClick={onClick}
    >
      <VStack align="center" gap="x0_5">
        <Icon svg={<EnvelopeIcon />} size={18} />
        <Text textStyle="captionSm" color="fg.neutral-muted" align="center">
          견적서
        </Text>
      </VStack>
    </Box>
  );
}
