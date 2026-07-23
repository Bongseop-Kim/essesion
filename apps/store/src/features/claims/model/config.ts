import type { OrderItemOut } from "@essesion/api-client";

export type ClaimType = "cancel" | "return" | "exchange";
export type ClaimListType = ClaimType | "token_refund";
export type ClaimReason =
  | "change_mind"
  | "defect"
  | "delay"
  | "wrong_item"
  | "size_mismatch"
  | "color_mismatch"
  | "other";

type ClaimTypeConfig = {
  label: string;
  action: `claim_${ClaimType}`;
  reasons: readonly ClaimReason[];
  notices: readonly string[];
};

export const CLAIM_TYPE_CONFIG: Record<ClaimType, ClaimTypeConfig> = {
  cancel: {
    label: "취소",
    action: "claim_cancel",
    reasons: ["change_mind", "defect", "delay", "wrong_item", "other"],
    notices: [
      "상품 준비가 시작된 뒤에는 취소가 제한될 수 있습니다.",
      "승인된 취소 금액은 결제 수단에 따라 환불됩니다.",
    ],
  },
  return: {
    label: "반품",
    action: "claim_return",
    reasons: [
      "change_mind",
      "defect",
      "wrong_item",
      "size_mismatch",
      "color_mismatch",
      "other",
    ],
    notices: [
      "반품은 상품 수령 후 7일 이내에 신청해 주세요.",
      "단순 변심 반품은 왕복 배송비가 차감될 수 있습니다.",
    ],
  },
  exchange: {
    label: "교환",
    action: "claim_exchange",
    reasons: [
      "defect",
      "wrong_item",
      "size_mismatch",
      "color_mismatch",
      "other",
    ],
    notices: [
      "교환은 상품 수령 후 7일 이내에 신청해 주세요.",
      "재고가 없으면 교환 대신 환불로 안내될 수 있습니다.",
    ],
  },
};

export const CLAIM_TYPES = Object.keys(CLAIM_TYPE_CONFIG) as ClaimType[];

const REASON_LABELS: Record<string, string> = {
  change_mind: "단순 변심",
  defect: "상품 불량",
  delay: "배송 지연",
  wrong_item: "다른 상품 배송",
  size_mismatch: "사이즈 불일치",
  color_mismatch: "색상 불일치",
  other: "기타",
  token_refund: "토큰 환불", // 서버가 token_refund 클레임의 reason에 기록하는 고정값
};

export function claimTypeLabel(type: string): string {
  if (type === "token_refund") return "토큰 환불";
  return CLAIM_TYPE_CONFIG[type as ClaimType]?.label ?? type;
}

export function claimReasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

export function claimStatusTone(
  status: string,
): "neutral" | "positive" | "critical" | "warning" | "informative" {
  if (status === "완료") return "positive";
  if (status === "거부") return "critical";
  if (status === "접수") return "warning";
  if (["처리중", "수거요청", "수거완료", "재발송"].includes(status)) {
    return "informative";
  }
  return "neutral";
}

/** 주문 시점 item_data 스냅샷에서 "상품명 (옵션명)" 라벨을 복원한다. 스냅샷이 없는 레거시 주문은 null. */
function productSnapshotTitle(
  itemData: OrderItemOut["item_data"],
): string | null {
  const product = itemData?.product;
  if (typeof product !== "object" || product === null) return null;
  const name = (product as { name?: unknown }).name;
  if (typeof name !== "string" || name === "") return null;
  const option = itemData?.option;
  const optionName =
    typeof option === "object" && option !== null
      ? (option as { name?: unknown }).name
      : null;
  return typeof optionName === "string" && optionName !== ""
    ? `${name} (${optionName})`
    : name;
}

export function claimItemTitle(item: OrderItemOut): string {
  if (item.item_type === "reform") return "넥타이 수선";
  if (item.item_type === "custom") return "맞춤 주문";
  if (item.item_type === "sample") return "샘플 주문";
  if (item.item_type === "token") return "디자인 토큰";
  return (
    productSnapshotTitle(item.item_data) ??
    (item.product_id ? `상품 #${item.product_id}` : "상품")
  );
}
