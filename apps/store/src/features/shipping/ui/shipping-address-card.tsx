import type { ShippingAddressOut } from "@essesion/api-client";
import {
  ActionButton,
  Badge,
  Box,
  HStack,
  Text,
  VStack,
} from "@essesion/shared";

import { deliveryRequestLabel } from "../model/delivery-request";

export function ShippingAddressCard({
  address,
  onChange,
}: {
  address: ShippingAddressOut | null;
  onChange?: () => void;
}) {
  const request = address
    ? deliveryRequestLabel(address.delivery_request, address.delivery_memo)
    : undefined;

  return (
    <Box
      bg="bg.layer-default"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      p={{ base: "x4", md: "x5" }}
    >
      <HStack justify="space-between" gap="x4" align="flex-start">
        <VStack gap="x2" minWidth={0}>
          <HStack gap="x2" wrap>
            <Text as="h2" textStyle="title3">
              배송지
            </Text>
            {address?.is_default ? <Badge variant="outline">기본</Badge> : null}
          </HStack>
          {address ? (
            <VStack gap="x1">
              <Text textStyle="label">
                {address.recipient_name} · {address.recipient_phone}
              </Text>
              <Text textStyle="bodySm" color="fg.neutral-muted">
                ({address.postal_code}) {address.address}{" "}
                {address.address_detail}
              </Text>
              {request ? (
                <Text textStyle="caption" color="fg.neutral-muted">
                  {request}
                </Text>
              ) : null}
            </VStack>
          ) : (
            <Text textStyle="bodySm" color="fg.neutral-muted">
              결제 전에 배송지를 등록해 주세요.
            </Text>
          )}
        </VStack>
        {onChange ? (
          <ActionButton
            type="button"
            variant="ghost"
            size="small"
            onClick={onChange}
          >
            {address ? "변경" : "등록"}
          </ActionButton>
        ) : null}
      </HStack>
    </Box>
  );
}
