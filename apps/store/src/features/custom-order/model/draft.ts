import { z } from "zod";

import {
  type CustomOrderDraft,
  type CustomOrderOptions,
  DEFAULT_CUSTOM_ORDER_OPTIONS,
  DEFAULT_QUOTE_CONTACT,
  type QuoteContact,
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
    // 차단 시점에 첨부가 있었는지 — 파일은 storage로 옮길 수 없어 재첨부 안내에만 쓴다
    hadAttachments: z.boolean().default(false),
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

export type CustomOrderDraftEntry = {
  draft: CustomOrderFormDraft;
  hadAttachments: boolean;
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

function readCustomOrderDraftEntry(
  ownerUserId: string | null,
): CustomOrderDraftEntry | null {
  const key = customOrderDraftStorageKey(ownerUserId);
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const parsed = storedFormDraftSchema.safeParse(JSON.parse(raw));
      if (parsed.success && parsed.data.ownerUserId === ownerUserId) {
        return {
          draft: parsed.data.draft,
          hadAttachments: parsed.data.hadAttachments,
        };
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

export function readCustomOrderFormDraft(
  ownerUserId: string | null,
): CustomOrderFormDraft | null {
  return readCustomOrderDraftEntry(ownerUserId)?.draft ?? null;
}

function isSameValues<T extends object>(value: T, reference: T) {
  return (Object.keys(reference) as (keyof T)[]).every(
    (key) => value[key] === reference[key],
  );
}

/** 아직 아무것도 입력하지 않은 초안 — 저장하지 않으므로 "초안 존재 = 실제 입력"이 성립한다. */
function isEmptyCustomOrderFormDraft(value: CustomOrderFormDraft) {
  return (
    isSameValues(value.options, DEFAULT_CUSTOM_ORDER_OPTIONS) &&
    isSameValues(value.contact, DEFAULT_QUOTE_CONTACT)
  );
}

/**
 * 폼 초안을 저장한다. 기본값 그대로인 초안은 저장하지 않고 기존 키를 지운다.
 * `hadAttachments`는 생략하면 저장된 값을 유지하고, 명시하면 그 값으로 덮는다.
 */
export function saveCustomOrderFormDraft(
  ownerUserId: string | null,
  value: CustomOrderFormDraft,
  options?: { hadAttachments?: boolean },
) {
  const hadAttachments =
    options?.hadAttachments ??
    readCustomOrderDraftEntry(ownerUserId)?.hadAttachments ??
    false;
  if (!hadAttachments && isEmptyCustomOrderFormDraft(value)) {
    clearCustomOrderFormDraft(ownerUserId);
    return;
  }
  try {
    sessionStorage.setItem(
      customOrderDraftStorageKey(ownerUserId),
      JSON.stringify({ ownerUserId, draft: value, hadAttachments }),
    );
  } catch {
    // Storage 접근이 차단된 브라우저에서는 메모리의 폼 상태만 사용한다.
  }
}

/**
 * 화면 진입 시 복원할 초안을 돌려준다. 로그인 상태에서 익명 초안이 남아 있으면
 * (로그인 경로와 무관하게) 계정 키로 이관하고 익명 사본을 지운다 — 익명 초안이
 * 가장 최근 작업이므로 계정 초안보다 우선한다. 재호출해도 결과는 같다.
 */
export function restoreCustomOrderFormDraft(
  ownerUserId: string | null,
): CustomOrderDraftEntry | null {
  if (ownerUserId === null) return readCustomOrderDraftEntry(null);
  const anonymous = readCustomOrderDraftEntry(null);
  if (!anonymous) return readCustomOrderDraftEntry(ownerUserId);
  saveCustomOrderFormDraft(ownerUserId, anonymous.draft, {
    hadAttachments: anonymous.hadAttachments,
  });
  clearCustomOrderFormDraft(null);
  return anonymous;
}

/** 재첨부 안내를 한 번 띄운 뒤 플래그를 지운다. */
export function clearCustomOrderDraftAttachments(ownerUserId: string | null) {
  const entry = readCustomOrderDraftEntry(ownerUserId);
  if (!entry?.hadAttachments) return;
  saveCustomOrderFormDraft(ownerUserId, entry.draft, { hadAttachments: false });
}

export function clearCustomOrderFormDraft(ownerUserId: string | null) {
  removeCustomOrderDraftItem(customOrderDraftStorageKey(ownerUserId));
}

export function parseCustomOrderDraft(value: unknown): CustomOrderDraft | null {
  const parsed = orderDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
