import { describe, expect, it } from "vitest";

import { deliveryRequestLabel } from "./delivery-request";

describe("deliveryRequestLabel", () => {
  it("저장 코드를 사용자 문구로 바꾼다", () => {
    expect(deliveryRequestLabel("DELIVERY_REQUEST_1")).toBe(
      "문 앞에 놔주세요.",
    );
  });

  it("직접입력은 메모를 표시한다", () => {
    expect(
      deliveryRequestLabel("DELIVERY_REQUEST_5", "경비실에 전화해 주세요."),
    ).toBe("경비실에 전화해 주세요.");
  });
});
