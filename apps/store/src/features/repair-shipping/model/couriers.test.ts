import { describe, expect, it } from "vitest";

import { courierTrackingUrl } from "./couriers";

describe("courierTrackingUrl", () => {
  it("코드와 admin이 저장한 이름 모두 같은 조회 URL을 만든다", () => {
    const byCode = courierTrackingUrl("cj", "1234");
    expect(byCode).toContain("slipno=1234");
    expect(courierTrackingUrl("CJ대한통운", "1234")).toBe(byCode);
  });

  it("템플릿이 없는 택배사·직접 적은 이름은 null이다", () => {
    expect(courierTrackingUrl("일양로지스", "1234")).toBeNull();
    expect(courierTrackingUrl("동네택배", "1234")).toBeNull();
  });
});
