import { describe, expect, it } from "vitest";

import { formatRepairReceiptReason } from "./format";

describe("formatRepairReceiptReason", () => {
  it.each([
    ["quick", "퀵서비스"],
    ["overseas", "해외 발송"],
    ["lost", "송장 분실"],
    ["unknown", "사유 없음"],
    [undefined, "사유 없음"],
  ])("%s 사유를 사용자 라벨로 표시한다", (value, expected) => {
    expect(formatRepairReceiptReason(value)).toBe(expected);
  });
});
