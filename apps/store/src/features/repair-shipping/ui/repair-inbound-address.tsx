import {
  ActionButton,
  Callout,
  HStack,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";

import {
  REPAIR_INBOUND_ADDRESS,
  repairInboundAddressText,
} from "../model/inbound-address";

type RepairInboundAddressProps = {
  onRegisterShipment?: () => void;
};

export function RepairInboundAddress({
  onRegisterShipment,
}: RepairInboundAddressProps) {
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(repairInboundAddressText());
      snackbar("수선품 보낼 주소를 복사했습니다.");
    } catch {
      snackbar("주소를 복사하지 못했습니다. 직접 선택해 복사해 주세요.");
    }
  };

  return (
    <Callout tone="informative" title="수선품 보내실 곳">
      <VStack gap="x2" alignItems="stretch">
        <Text textStyle="bodySm">
          받는 사람 · {REPAIR_INBOUND_ADDRESS.recipient}
        </Text>
        <Text textStyle="bodySm">주소 · {REPAIR_INBOUND_ADDRESS.address}</Text>
        <Text textStyle="bodySm">연락처 · {REPAIR_INBOUND_ADDRESS.phone}</Text>
        <HStack gap="x2" wrap="wrap">
          <ActionButton
            type="button"
            size="small"
            variant="neutralOutline"
            onClick={() => void copyAddress()}
          >
            주소 복사
          </ActionButton>
          {onRegisterShipment ? (
            <ActionButton
              type="button"
              size="small"
              variant="neutralWeak"
              onClick={onRegisterShipment}
            >
              발송 정보 등록
            </ActionButton>
          ) : null}
        </HStack>
      </VStack>
    </Callout>
  );
}
