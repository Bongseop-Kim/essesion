// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearCustomOrderFormDraft,
  parseCustomOrderDraft,
  parseCustomOrderFormDraft,
  readCustomOrderFormDraft,
  saveCustomOrderFormDraft,
} from "./draft";
import { DEFAULT_CUSTOM_ORDER_OPTIONS, DEFAULT_QUOTE_CONTACT } from "./options";

describe("custom order draft", () => {
  const formDraft = {
    options: DEFAULT_CUSTOM_ORDER_OPTIONS,
    contact: DEFAULT_QUOTE_CONTACT,
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

  it("로그인 복귀 draft는 해당 계정으로 인계하고 익명 사본을 제거한다", () => {
    saveCustomOrderFormDraft(null, formDraft);
    const loginDraft = {
      ...formDraft,
      contact: { ...formDraft.contact, contactName: "logged-in" },
    };

    saveCustomOrderFormDraft("user-a", loginDraft);
    clearCustomOrderFormDraft(null);

    expect(readCustomOrderFormDraft("user-a")).toEqual(loginDraft);
    expect(readCustomOrderFormDraft(null)).toBeNull();
  });
});
