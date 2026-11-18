import { ActionButton, Box, Icon, Text, VStack } from "@essesion/shared";
import { EnvelopeIcon } from "@heroicons/react/24/outline";

/** 견적서 메일 버튼 — 상품 상세의 찜 버튼과 같은 자리·크기(액션 바 1열). */
export function EstimateMailButton({
  disabled,
  onClick,
  "aria-label": ariaLabel = "견적서 메일로 받기",
}: {
  disabled?: boolean;
  onClick: () => void;
  /** 정보 탭처럼 메일 창을 열지 않는 자리에서는 실제 동작으로 바꿔 준다. */
  "aria-label"?: string;
}) {
  return (
    <Box
      as={ActionButton}
      type="button"
      variant="neutralWeak"
      size="large"
      iconOnly
      aria-label={ariaLabel}
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
