export const REPAIR_INBOUND_ADDRESS = {
  recipient: "영선산업",
  address: "대전광역시 동구 우암로246번길 9-16 (가양동) 영선산업",
  phone: "042-626-9055",
} as const;

export function repairInboundAddressText(): string {
  return [
    REPAIR_INBOUND_ADDRESS.recipient,
    REPAIR_INBOUND_ADDRESS.address,
    REPAIR_INBOUND_ADDRESS.phone,
  ].join(" / ");
}
