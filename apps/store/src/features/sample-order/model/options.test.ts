import { describe, expect, it } from "vitest";

import { DEFAULT_SAMPLE_ORDER_OPTIONS, sampleOrderApiOptions } from "./options";

describe("sample order options", () => {
  it("봉제 샘플은 원단 옵션을 서버 요청에서 비운다", () => {
    expect(
      sampleOrderApiOptions({
        ...DEFAULT_SAMPLE_ORDER_OPTIONS,
        sampleType: "sewing",
      }),
    ).toMatchObject({ fabric_type: null, design_type: null });
  });
});
