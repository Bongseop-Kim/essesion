import { describe, expect, it } from "vitest";

import { parseCustomOrderDraft, parseCustomOrderFormDraft } from "./draft";
import { DEFAULT_CUSTOM_ORDER_OPTIONS, DEFAULT_QUOTE_CONTACT } from "./options";

describe("custom order draft", () => {
  const formDraft = {
    options: DEFAULT_CUSTOM_ORDER_OPTIONS,
    contact: DEFAULT_QUOTE_CONTACT,
  };

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
});
