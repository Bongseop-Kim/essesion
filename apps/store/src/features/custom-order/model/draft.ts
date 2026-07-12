import { z } from "zod";

import type {
  CustomOrderDraft,
  CustomOrderOptions,
  QuoteContact,
} from "./options";

export const CUSTOM_ORDER_DRAFT_KEY = "custom-order:draft:v2";

const optionsSchema = z
  .object({
    fabricProvided: z.boolean(),
    reorder: z.boolean(),
    fabricType: z.enum(["POLY", "SILK"]),
    designType: z.enum(["PRINTING", "YARN_DYED"]),
    tieType: z.enum(["MANUAL", "AUTO"]),
    interlining: z.enum(["POLY", "WOOL"]),
    sizeType: z.enum(["ADULT", "CHILD"]),
    tieWidth: z.union([z.number().finite(), z.literal("")]),
    triangleStitch: z.boolean(),
    sideStitch: z.boolean(),
    barTack: z.boolean(),
    fold7: z.boolean(),
    dimple: z.boolean(),
    turnKnot: z.boolean().default(false),
    spoderato: z.boolean(),
    brandLabel: z.boolean(),
    careLabel: z.boolean(),
    quantity: z.number().finite(),
    additionalNotes: z.string().max(500),
  })
  .strict();

const contactSchema = z
  .object({
    contactName: z.string(),
    businessName: z.string(),
    contactMethod: z.enum(["phone", "email"]),
    contactValue: z.string(),
  })
  .strict();

const orderOptionsSchema = optionsSchema.extend({
  tieWidth: z.number().finite(),
});

const formDraftSchema = z
  .object({ options: optionsSchema, contact: contactSchema })
  .strict();

const orderDraftSchema = z
  .object({
    options: orderOptionsSchema,
    contact: contactSchema,
    imageRefs: z.array(z.object({ upload_id: z.string().uuid() }).strict()),
    totalCost: z.number().int().nonnegative(),
  })
  .strict();

export type CustomOrderFormDraft = {
  options: CustomOrderOptions;
  contact: QuoteContact;
};

export function parseCustomOrderFormDraft(
  value: unknown,
): CustomOrderFormDraft | null {
  const parsed = formDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readCustomOrderFormDraft(): CustomOrderFormDraft | null {
  try {
    return parseCustomOrderFormDraft(
      JSON.parse(sessionStorage.getItem(CUSTOM_ORDER_DRAFT_KEY) ?? "null"),
    );
  } catch {
    return null;
  }
}

export function saveCustomOrderFormDraft(value: CustomOrderFormDraft) {
  sessionStorage.setItem(CUSTOM_ORDER_DRAFT_KEY, JSON.stringify(value));
}

export function clearCustomOrderFormDraft() {
  sessionStorage.removeItem(CUSTOM_ORDER_DRAFT_KEY);
}

export function parseCustomOrderDraft(value: unknown): CustomOrderDraft | null {
  const parsed = orderDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
