import { z } from "zod";

import type {
  CustomOrderDraft,
  CustomOrderOptions,
  QuoteContact,
} from "./options";

const CUSTOM_ORDER_DRAFT_KEY = "custom-order:draft:v3";

const ANONYMOUS_DRAFT_OWNER = "anonymous";

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

const storedFormDraftSchema = z
  .object({
    ownerUserId: z.string().nullable(),
    draft: formDraftSchema,
  })
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

function customOrderDraftStorageKey(ownerUserId: string | null) {
  const owner =
    ownerUserId === null
      ? ANONYMOUS_DRAFT_OWNER
      : `user:${encodeURIComponent(ownerUserId)}`;
  return `${CUSTOM_ORDER_DRAFT_KEY}:${owner}`;
}

function removeCustomOrderDraftItem(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage 접근이 차단된 브라우저에서는 메모리의 폼 상태만 사용한다.
  }
}

export function readCustomOrderFormDraft(
  ownerUserId: string | null,
): CustomOrderFormDraft | null {
  const key = customOrderDraftStorageKey(ownerUserId);
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const parsed = storedFormDraftSchema.safeParse(JSON.parse(raw));
      if (parsed.success && parsed.data.ownerUserId === ownerUserId) {
        return parsed.data.draft;
      }
      removeCustomOrderDraftItem(key);
      return null;
    }

    return null;
  } catch {
    removeCustomOrderDraftItem(key);
    return null;
  }
}

export function saveCustomOrderFormDraft(
  ownerUserId: string | null,
  value: CustomOrderFormDraft,
) {
  sessionStorage.setItem(
    customOrderDraftStorageKey(ownerUserId),
    JSON.stringify({ ownerUserId, draft: value }),
  );
}

export function clearCustomOrderFormDraft(ownerUserId: string | null) {
  removeCustomOrderDraftItem(customOrderDraftStorageKey(ownerUserId));
}

export function handoffAnonymousCustomOrderFormDraft(
  ownerUserId: string,
  value: CustomOrderFormDraft,
) {
  saveCustomOrderFormDraft(ownerUserId, value);
  clearCustomOrderFormDraft(null);
}

export function parseCustomOrderDraft(value: unknown): CustomOrderDraft | null {
  const parsed = orderDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
