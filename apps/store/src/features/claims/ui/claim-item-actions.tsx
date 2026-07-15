import type { OrderItemOut } from "@essesion/api-client";
import { ActionButton, HStack } from "@essesion/shared";

import {
  CLAIM_TYPE_CONFIG,
  CLAIM_TYPES,
  type ClaimType,
} from "../model/config";

type ClaimItemActionsProps = {
  item: OrderItemOut;
  customerActions: readonly string[];
  onSelect: (type: ClaimType, item: OrderItemOut) => void;
};

export function ClaimItemActions({
  item,
  customerActions,
  onSelect,
}: ClaimItemActionsProps) {
  if (item.claim && item.claim.status !== "거부") return null;

  const actions = new Set(customerActions);
  const available = CLAIM_TYPES.filter((type) =>
    actions.has(CLAIM_TYPE_CONFIG[type].action),
  );

  if (available.length === 0) return null;

  return (
    <HStack gap="x2" wrap="wrap">
      {available.map((type) => (
        <ActionButton
          key={type}
          type="button"
          size="small"
          variant="neutralOutline"
          onClick={() => onSelect(type, item)}
        >
          {CLAIM_TYPE_CONFIG[type].label} 요청
        </ActionButton>
      ))}
    </HStack>
  );
}
