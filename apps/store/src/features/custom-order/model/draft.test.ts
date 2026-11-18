// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearCustomOrderDraftAttachments,
  parseCustomOrderDraft,
  parseCustomOrderFormDraft,
  parseCustomQuoteDraft,
  readCustomOrderFormDraft,
  restoreCustomOrderFormDraft,
  saveCustomOrderFormDraft,
} from "./draft";
import { DEFAULT_CUSTOM_ORDER_OPTIONS } from "./options";

describe("custom order draft", () => {
  const formDraft = {
    options: DEFAULT_CUSTOM_ORDER_OPTIONS,
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
    // 포인트 주문은 폭 칸이 숨어 빈 값으로 넘어온다 — 결제 페이지가 초안을 버리면 안 된다
    expect(
      parseCustomOrderDraft({
        ...formDraft,
        options: { ...formDraft.options, pointEnabled: true },
        imageRefs: [],
        totalCost: 120_000,
      }),
    ).not.toBeNull();
  });

  it("결제 draft의 완료된 업로드 ID와 금액을 검증한다", () => {
    expect(
      parseCustomOrderDraft({
        ...formDraft,
        options: { ...formDraft.options, tieWidth: 8 },
        // 칸 사진(part)과 추가 이미지(part 없음)가 섞여 넘어온다
        imageRefs: [
          { upload_id: "89dc3b35-9ca2-4b18-a0e0-02a099d76a23", part: "blade" },
          { upload_id: "0b04b9c7-28e2-452f-866f-de101ba1cde4" },
        ],
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

  it("견적 초안은 스테이징 키(object_key) 이미지만 받는다", () => {
    const quoteDraft = {
      ownerUserId: "user-a",
      options: { ...formDraft.options, tieWidth: 8 },
      imageRefs: [
        { object_key: "uploads/quote_request/a.png", part: "blade" },
        { object_key: "uploads/quote_request/b.png" },
      ],
      totalCost: 120_000,
    };
    expect(parseCustomQuoteDraft(quoteDraft)).toEqual(quoteDraft);
    // 결제 초안(upload_id)을 견적 페이지로 넘기면 버린다 — 반대도 마찬가지
    expect(
      parseCustomQuoteDraft({
        ...quoteDraft,
        imageRefs: [{ upload_id: "89dc3b35-9ca2-4b18-a0e0-02a099d76a23" }],
      }),
    ).toBeNull();
    expect(parseCustomOrderDraft(quoteDraft)).toBeNull();
    // 만든 계정이 없는 초안은 받지 않는다
    const { ownerUserId: _owner, ...ownerless } = quoteDraft;
    expect(parseCustomQuoteDraft(ownerless)).toBeNull();
  });

  it("A의 폼 draft를 B나 익명 방문자에게 노출하지 않는다", () => {
    const anonymousDraft = {
      ...formDraft,
      options: { ...formDraft.options, additionalNotes: "anonymous" },
    };
    const accountDraft = {
      ...formDraft,
      options: { ...formDraft.options, additionalNotes: "account-a" },
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
      options: { ...formDraft.options, additionalNotes: "before-login" },
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
