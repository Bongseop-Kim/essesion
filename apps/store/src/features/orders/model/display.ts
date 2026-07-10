const ORDER_TYPE_LABELS: Record<string, string> = {
  sale: "상품",
  repair: "수선",
  custom: "주문 제작",
  sample: "샘플",
  token: "토큰",
};

export function orderTypeLabel(type: string): string {
  return ORDER_TYPE_LABELS[type] ?? type;
}

const POSITIVE_STATUSES = new Set(["완료", "배송완료", "제작완료", "수선완료"]);
const CRITICAL_STATUSES = new Set(["취소", "실패"]);
const WARNING_STATUSES = new Set(["대기중", "결제중", "발송대기"]);
const PROGRESS_STATUSES = new Set([
  "진행중",
  "배송중",
  "접수",
  "제작중",
  "수선중",
  "발송중",
  "발송확인중",
  "수거예정",
]);

export function orderStatusTone(
  status: string,
): "neutral" | "positive" | "critical" | "warning" | "informative" {
  if (POSITIVE_STATUSES.has(status)) return "positive";
  if (CRITICAL_STATUSES.has(status)) return "critical";
  if (WARNING_STATUSES.has(status)) return "warning";
  if (PROGRESS_STATUSES.has(status)) return "informative";
  return "neutral";
}

/** 고객 송장 등록 가능 여부 — 서버 customer_actions에 없으므로 프론트 규칙 */
export function canRegisterRepairShipment(order: {
  order_type: string;
  status: string;
}): boolean {
  return order.order_type === "repair" && order.status === "발송대기";
}

const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" });

export function formatOrderDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
