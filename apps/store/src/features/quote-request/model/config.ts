export const QUOTE_REQUEST_STATUSES = [
  "요청",
  "견적발송",
  "협의중",
  "확정",
  "종료",
] as const;

export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];
export type QuoteRequestFilter = "all" | QuoteRequestStatus;

export const QUOTE_REQUEST_FILTERS: readonly {
  value: QuoteRequestFilter;
  label: string;
}[] = [
  { value: "all", label: "전체" },
  ...QUOTE_REQUEST_STATUSES.map((status) => ({
    value: status,
    label: status,
  })),
];

type StatusTone =
  | "neutral"
  | "positive"
  | "critical"
  | "warning"
  | "informative";

const STATUS_TONES: Record<QuoteRequestStatus, StatusTone> = {
  요청: "neutral",
  견적발송: "informative",
  협의중: "warning",
  확정: "positive",
  종료: "critical",
};

const CONTACT_METHOD_LABELS: Record<string, string> = {
  email: "이메일",
  phone: "전화",
};

const amountFormat = new Intl.NumberFormat("ko-KR");
const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" });

export function quoteRequestStatusTone(status: string): StatusTone {
  return STATUS_TONES[status as QuoteRequestStatus] ?? "neutral";
}

export function quoteContactMethodLabel(method: string): string {
  return CONTACT_METHOD_LABELS[method] ?? "기타";
}

export function quoteContactName(
  contactName: string,
  businessName: string,
): string {
  const business = businessName.trim();
  return business ? `${contactName} · ${business}` : contactName;
}

export function formatQuoteAmount(amount: number): string {
  return `${amountFormat.format(amount)}원`;
}

export function formatQuoteDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
