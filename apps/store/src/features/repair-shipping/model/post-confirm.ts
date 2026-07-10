import type { ConfirmedOrder } from "@essesion/api-client";
import type { RepairShipmentDraft } from "./shipment";

export type RepairPostConfirmPlan =
  | { kind: "none" }
  | { kind: "pickup" }
  | { kind: "submitted" }
  | { kind: "auto-submit"; orderId: string; draft: RepairShipmentDraft }
  | { kind: "register-cta"; orderId: string };

/** 결제 confirm 응답으로 수선 후속 처리를 결정한다.
 *  분기는 pending의 method 추정이 아니라 서버 status 기준 — 다른 기기/세션에서도 정확하다.
 *  주문 생성 로직상 payment group당 repair 주문은 최대 1건(sale/repair 분리 생성)이라 find로 충분. */
export function planRepairOutcome(
  orders: readonly ConfirmedOrder[],
  draft: RepairShipmentDraft | null,
): RepairPostConfirmPlan {
  const repair = orders.find((order) => order.order_type === "repair");
  if (!repair) return { kind: "none" };
  if (repair.status === "수거예정") return { kind: "pickup" };
  // 발송대기가 아니면 이미 등록됨(발송중·발송확인중) — 멱등 재confirm 시 재제출 방지
  if (repair.status !== "발송대기") return { kind: "submitted" };
  if (draft) return { kind: "auto-submit", orderId: repair.order_id, draft };
  return { kind: "register-cta", orderId: repair.order_id };
}
