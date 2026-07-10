import type { OrderOut } from "@essesion/api-client";
import {
  submitRepairNoTracking,
  submitRepairTracking,
} from "@essesion/api-client";
import type { RepairShipmentDraft } from "../model/shipment";
import { shipmentRequestBody } from "../model/shipment";

/** success 자동 제출·등록 페이지 공용 단일 진입점 — 발송대기→발송중/발송확인중 */
export async function submitRepairShipment(
  orderId: string,
  draft: RepairShipmentDraft,
): Promise<OrderOut> {
  const request = shipmentRequestBody(draft);
  const result =
    request.type === "tracking"
      ? await submitRepairTracking({
          path: { order_id: orderId },
          body: request.body,
        })
      : await submitRepairNoTracking({
          path: { order_id: orderId },
          body: request.body,
        });
  if (!result.data) throw new Error("발송 정보를 등록하지 못했습니다.");
  return result.data;
}
