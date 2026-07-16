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

export function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "-";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? money.format(numeric) : "-";
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
