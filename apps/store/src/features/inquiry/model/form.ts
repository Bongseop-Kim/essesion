import type { InquiryCreateRequest, InquiryOut } from "@essesion/api-client";
import { zInquiryCreateRequest } from "@essesion/api-client/zod";
import { z } from "zod";

import {
  INQUIRY_CATEGORY_VALUES,
  type InquiryPrefill,
  inquiryCategory,
} from "./config";

export const inquiryFormSchema = zInquiryCreateRequest
  .extend({
    category: z.enum(INQUIRY_CATEGORY_VALUES),
    title: z
      .string()
      .trim()
      .min(1, "제목을 입력해 주세요.")
      .max(200, "제목은 200자까지 입력할 수 있어요."),
    content: z
      .string()
      .trim()
      .min(1, "문의 내용을 입력해 주세요.")
      .max(5000, "문의 내용은 5,000자까지 입력할 수 있어요."),
    product_id: z.number().int().positive().nullable(),
  })
  .superRefine((values, context) => {
    if (values.category === "상품" && values.product_id === null) {
      context.addIssue({
        code: "custom",
        path: ["product_id"],
        message: "문의할 상품을 선택해 주세요.",
      });
    }
  });

export type InquiryFormValues = z.input<typeof inquiryFormSchema>;

export const DEFAULT_INQUIRY_FORM_VALUES: InquiryFormValues = {
  category: "일반",
  title: "",
  content: "",
  product_id: null,
};

export function inquiryFormValues(
  inquiry: InquiryOut | null,
  prefill: InquiryPrefill | null,
): InquiryFormValues {
  if (inquiry) {
    return {
      category: inquiryCategory(inquiry.category),
      title: inquiry.title,
      content: inquiry.content,
      product_id: inquiry.product_id,
    };
  }
  if (prefill) {
    return {
      ...DEFAULT_INQUIRY_FORM_VALUES,
      category: prefill.category,
      product_id: prefill.productId,
    };
  }
  return DEFAULT_INQUIRY_FORM_VALUES;
}

export function inquiryRequestFromForm(
  values: InquiryFormValues,
): InquiryCreateRequest {
  return {
    category: values.category,
    title: values.title.trim(),
    content: values.content.trim(),
    product_id: values.category === "상품" ? values.product_id : null,
  };
}
