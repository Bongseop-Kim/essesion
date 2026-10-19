import { describe, expect, it } from "vitest";

import { formatDeliveryRequest, formatRepairReceiptReason } from "./format";

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

describe("formatDeliveryRequest", () => {
  it.each([
    ["DELIVERY_REQUEST_2", "오후 배송", "경비실에 맡겨 주세요. · 오후 배송"],
    ["DELIVERY_REQUEST_5", "벨 누르지 마세요", "벨 누르지 마세요"],
    ["DELIVERY_REQUEST_1", null, "문 앞에 놔주세요."],
    [null, null, "-"],
  ])("%s·%s를 한 줄 배송 메모로 표시한다", (request, memo, expected) => {
    expect(formatDeliveryRequest(request, memo)).toBe(expected);
  });
});
