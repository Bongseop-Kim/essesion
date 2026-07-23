import { HStack, Text } from "@essesion/shared";

/** label·value 한 줄 — 주문·클레임·토큰 상세의 공통 정보 행. */
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap="x4" align="flex-start">
      <Text textStyle="bodySm" color="fg.neutral-muted">
        {label}
      </Text>
      <Text textStyle="bodySm">{value}</Text>
    </HStack>
  );
}
