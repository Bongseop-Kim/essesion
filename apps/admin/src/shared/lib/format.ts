const money = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

const dateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});

const date = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
});

function parsed(value: string | Date) {
  const result = value instanceof Date ? value : new Date(value);
  return Number.isNaN(result.valueOf()) ? null : result;
}

export function formatMoney(
  value: number | string | null | undefined,
  emptyLabel = "-",
) {
  if (value === null || value === undefined) return emptyLabel;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? money.format(numeric) : emptyLabel;
}

/** 금액을 한 줄로 — `100,000 − 10,000 + 3,000 = ₩93,000` (작업지시서 표기). */
export function formatAmountBreakdown(
  original: number,
  discount: number,
  shipping: number,
) {
  const plain = (value: number) => value.toLocaleString("ko-KR");
  return `${plain(original)} − ${plain(discount)} + ${plain(shipping)} = ${formatMoney(
    original - discount + shipping,
  )}`;
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (value === null || value === undefined) return "-";
  const result = parsed(value);
  return result === null ? "-" : dateTime.format(result);
}

export function formatDate(value: string | Date | null | undefined) {
  if (value === null || value === undefined) return "-";
  const result = parsed(value);
  return result === null ? "-" : date.format(result);
}

export function formatIdentifier(value: string | number | null | undefined) {
  return value === null || value === undefined || value === ""
    ? "-"
    : String(value);
}

export function formatOrderType(value: string) {
  return (
    {
      sale: "일반",
      custom: "주문 제작",
      repair: "수선",
      token: "토큰",
      sample: "샘플",
    }[value] ?? value
  );
}

const REPAIR_RECEIPT_REASONS: Record<string, string> = {
  quick: "퀵서비스",
  overseas: "해외 발송",
  lost: "송장 분실",
};

export function formatRepairReceiptReason(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return "사유 없음";
  return REPAIR_RECEIPT_REASONS[value] ?? "사유 없음";
}

// ponytail: store의 DELIVERY_REQUEST_OPTIONS(features/shipping/model/delivery-request.ts)와
// 같은 라벨이다. 앱 간 import가 막혀 있어 복사해 둔다 — 옵션이 바뀌면 함께 고칠 것.
const DELIVERY_REQUESTS: Record<string, string> = {
  DELIVERY_REQUEST_1: "문 앞에 놔주세요.",
  DELIVERY_REQUEST_2: "경비실에 맡겨 주세요.",
  DELIVERY_REQUEST_3: "택배함에 넣어 주세요.",
  DELIVERY_REQUEST_4: "배송 전에 연락 주세요.",
};

// 배송 요청(선택지)과 메모(직접입력)를 한 줄로. 직접입력(DELIVERY_REQUEST_5)은 메모가 본문이다.
export function formatDeliveryRequest(
  request: string | null | undefined,
  memo: string | null | undefined,
) {
  const label =
    request && request !== "DELIVERY_REQUEST_5"
      ? (DELIVERY_REQUESTS[request] ?? request)
      : null;
  return [label, memo].filter(Boolean).join(" · ") || "-";
}

export function formatFileSize(value: number | null, unknownLabel = "-") {
  if (value === null) return unknownLabel;
  if (value < 1_024) return `${value.toLocaleString("ko-KR")}B`;
  return `${(value / 1_024).toFixed(1)}KB`;
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message !== "") return error.message;
  if (typeof error === "object" && error !== null) {
    const detail = Reflect.get(error, "detail");
    if (typeof detail === "string" && detail !== "") return detail;
  }
  return fallback;
}
