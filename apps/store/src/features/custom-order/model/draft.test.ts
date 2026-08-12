// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearCustomOrderDraftAttachments,
  parseCustomOrderDraft,
  parseCustomOrderFormDraft,
  readCustomOrderFormDraft,
  restoreCustomOrderFormDraft,
  saveCustomOrderFormDraft,
} from "./draft";
import { DEFAULT_CUSTOM_ORDER_OPTIONS, DEFAULT_QUOTE_CONTACT } from "./options";

describe("custom order draft", () => {
  const formDraft = {
    options: DEFAULT_CUSTOM_ORDER_OPTIONS,
    contact: DEFAULT_QUOTE_CONTACT,
  };
  /** 실제로 입력이 있는 초안 — 기본값 초안은 저장되지 않는다 */
  const editedDraft = {
    ...formDraft,
    options: { ...formDraft.options, tieWidth: 8 },
  };

  beforeEach(() => sessionStorage.clear());

  it("저장된 폼 draft 구조를 검증한다", () => {
    expect(parseCustomOrderFormDraft(formDraft)).toEqual(formDraft);
    expect(
      parseCustomOrderFormDraft({
        ...formDraft,
        options: { ...formDraft.options, quantity: "4" },
      }),
    ).toBeNull();
  });

  it("폼 draft만 빈 넥타이 폭을 허용한다", () => {
    expect(parseCustomOrderFormDraft(formDraft)).not.toBeNull();
    expect(
      parseCustomOrderDraft({
        ...formDraft,
        imageRefs: [],
        totalCost: 120_000,
      }),
    ).toBeNull();
  });

  it("결제 draft의 완료된 업로드 ID와 금액을 검증한다", () => {
    expect(
      parseCustomOrderDraft({
        ...formDraft,
        options: { ...formDraft.options, tieWidth: 8 },
        imageRefs: [{ upload_id: "89dc3b35-9ca2-4b18-a0e0-02a099d76a23" }],
        totalCost: 120_000,
      }),
    ).not.toBeNull();
    expect(
      parseCustomOrderDraft({
        ...formDraft,
        options: { ...formDraft.options, tieWidth: 8 },
        imageRefs: [{ object_key: "custom/image.webp" }],
        totalCost: 120_000,
      }),
    ).toBeNull();
    expect(
      parseCustomOrderDraft({
        ...formDraft,
        options: { ...formDraft.options, tieWidth: 8 },
        imageRefs: [],
        totalCost: -1,
      }),
    ).toBeNull();
  });

  it("A의 폼 draft를 B나 익명 방문자에게 노출하지 않는다", () => {
    const anonymousDraft = {
      ...formDraft,
      contact: { ...formDraft.contact, contactName: "anonymous" },
    };
    const accountDraft = {
      ...formDraft,
      contact: { ...formDraft.contact, contactName: "account-a" },
    };
    saveCustomOrderFormDraft(null, anonymousDraft);
    saveCustomOrderFormDraft("user-a", accountDraft);

    expect(readCustomOrderFormDraft("user-a")).toEqual(accountDraft);
    expect(readCustomOrderFormDraft("user-b")).toBeNull();
    expect(readCustomOrderFormDraft(null)).toEqual(anonymousDraft);
  });

  it("기본값 그대로인 초안은 저장하지 않고 기존 키를 지운다", () => {
    saveCustomOrderFormDraft(null, editedDraft);
    expect(readCustomOrderFormDraft(null)).toEqual(editedDraft);

    saveCustomOrderFormDraft(null, formDraft);

    expect(readCustomOrderFormDraft(null)).toBeNull();
  });

  it("익명 초안을 로그인 계정으로 이관하고 익명 키를 지운다", () => {
    saveCustomOrderFormDraft(null, editedDraft);
    saveCustomOrderFormDraft("user-a", {
      ...formDraft,
      contact: { ...formDraft.contact, contactName: "before-login" },
    });

    expect(restoreCustomOrderFormDraft("user-a")).toEqual({
      draft: editedDraft,
      hadAttachments: false,
    });

    // 익명 초안이 계정 초안을 덮고, 익명 사본은 남지 않는다
    expect(readCustomOrderFormDraft("user-a")).toEqual(editedDraft);
    expect(readCustomOrderFormDraft(null)).toBeNull();
    // 다시 호출해도(StrictMode 이중 렌더) 같은 초안을 돌려준다
    expect(restoreCustomOrderFormDraft("user-a")).toEqual({
      draft: editedDraft,
      hadAttachments: false,
    });
  });

  it("익명 초안이 없으면 계정 초안을 그대로 복원한다", () => {
    saveCustomOrderFormDraft("user-a", editedDraft);

    expect(restoreCustomOrderFormDraft("user-a")).toEqual({
      draft: editedDraft,
      hadAttachments: false,
    });
    expect(restoreCustomOrderFormDraft("user-b")).toBeNull();
  });

  it("첨부 플래그는 이관까지 살아남고 안내 후에만 지워진다", () => {
    saveCustomOrderFormDraft(null, editedDraft, { hadAttachments: true });
    expect(restoreCustomOrderFormDraft(null)).toEqual({
      draft: editedDraft,
      hadAttachments: true,
    });

    // 400ms 자동저장은 플래그를 건드리지 않는다
    saveCustomOrderFormDraft(null, editedDraft);
    expect(restoreCustomOrderFormDraft("user-a")).toEqual({
      draft: editedDraft,
      hadAttachments: true,
    });

    clearCustomOrderDraftAttachments("user-a");

    expect(restoreCustomOrderFormDraft("user-a")).toEqual({
      draft: editedDraft,
      hadAttachments: false,
    });
  });

  it("첨부만 있었던 기본값 초안도 재첨부 안내를 위해 남긴다", () => {
    saveCustomOrderFormDraft(null, formDraft, { hadAttachments: true });
    expect(restoreCustomOrderFormDraft(null)).toEqual({
      draft: formDraft,
      hadAttachments: true,
    });

    clearCustomOrderDraftAttachments(null);

    // 안내를 끝내면 남길 이유가 없다
    expect(readCustomOrderFormDraft(null)).toBeNull();
  });
});
