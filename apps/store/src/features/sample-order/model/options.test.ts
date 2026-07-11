import { describe, expect, it } from "vitest";

import {
  DEFAULT_SAMPLE_ORDER_OPTIONS,
  readSampleOrderDraft,
  sampleOrderApiOptions,
} from "./options";

describe("sample order options", () => {
  it("봉제 샘플은 원단 옵션을 서버 요청에서 비운다", () => {
    expect(
      sampleOrderApiOptions({
        ...DEFAULT_SAMPLE_ORDER_OPTIONS,
        sampleType: "sewing",
      }),
    ).toMatchObject({ fabric_type: null, design_type: null });
  });

  it("수동 타이는 서버 요청에서 타이 옵션을 비운다", () => {
    expect(
      sampleOrderApiOptions({
        ...DEFAULT_SAMPLE_ORDER_OPTIONS,
        tieType: "MANUAL",
      }),
    ).toMatchObject({ tie_type: null });
  });

  it("결제 draft가 올바른 형태일 때만 복원한다", () => {
    const draft = {
      options: DEFAULT_SAMPLE_ORDER_OPTIONS,
      imageRefs: [{ object_key: "sample_order/example.webp" }],
      totalCost: 60_000,
    };

    expect(readSampleOrderDraft({ sampleOrder: draft })).toEqual(draft);
    expect(
      readSampleOrderDraft({
        sampleOrder: { ...draft, totalCost: "60000" },
      }),
    ).toBeNull();
    expect(
      readSampleOrderDraft({
        sampleOrder: { ...draft, imageRefs: [{ url: "invalid" }] },
      }),
    ).toBeNull();
  });
});
