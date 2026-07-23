import type { InquiryCreateRequest, InquiryOut } from "@essesion/api-client";
import type { BadgeProps } from "@essesion/shared";

export type InquiryCategory = NonNullable<InquiryCreateRequest["category"]>;

export const INQUIRY_CATEGORY_VALUES = [
  "일반",
  "상품",
  "수선",
  "주문제작",
  "샘플제작",
] as const satisfies readonly InquiryCategory[];

export type InquiryPrefill = {
  category: InquiryCategory;
  productId: number | null;
};

export function isInquiryCategory(value: string): value is InquiryCategory {
  return INQUIRY_CATEGORY_VALUES.some((category) => category === value);
}

export function inquiryCategory(value: string): InquiryCategory {
  return isInquiryCategory(value) ? value : "일반";
}

export function inquiryStatusTone(
  status: string,
): NonNullable<BadgeProps["tone"]> {
  return status === "답변완료" ? "positive" : "neutral";
}

export function isInquiryEditable(status: string) {
  return status === "답변대기";
}

export function parseInquiryPrefill(
  searchParams: URLSearchParams,
): InquiryPrefill | null {
  const rawCategory = searchParams.get("category");
  const rawProductId =
    searchParams.get("product_id") ?? searchParams.get("productId");
  const parsedProductId = rawProductId === null ? NaN : Number(rawProductId);
  const productId =
    Number.isInteger(parsedProductId) && parsedProductId > 0
      ? parsedProductId
      : null;
  const category =
    rawCategory !== null && isInquiryCategory(rawCategory)
      ? rawCategory
      : productId !== null
        ? "상품"
        : null;

  if (category === null) return null;
  return {
    category,
    productId: category === "상품" ? productId : null,
  };
}

export type InquirySummary = {
  total: number;
  waiting: number;
  answered: number;
  latestAnswerDate: string | null;
};

export function summarizeInquiries(
  inquiries: readonly Pick<InquiryOut, "answer_date" | "status">[],
): InquirySummary {
  const answerDates = inquiries
    .map((inquiry) => inquiry.answer_date)
    .filter((date): date is string => date !== null)
    .sort((a, b) => b.localeCompare(a));

  return {
    total: inquiries.length,
    waiting: inquiries.filter((inquiry) => inquiry.status === "답변대기")
      .length,
    answered: inquiries.filter((inquiry) => inquiry.status === "답변완료")
      .length,
    latestAnswerDate: answerDates[0] ?? null,
  };
}
