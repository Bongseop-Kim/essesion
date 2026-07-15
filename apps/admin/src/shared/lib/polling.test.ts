import { describe, expect, it } from "vitest";

import { activeAdminPollingInterval } from "./polling";

describe("admin polling", () => {
  it("문서가 visible이고 활성 작업이 있으면 30초 간격으로 polling한다", () => {
    expect(activeAdminPollingInterval(true, "visible")).toBe(30_000);
  });

  it("활성 작업이 없으면 polling하지 않는다", () => {
    expect(activeAdminPollingInterval(false, "visible")).toBe(false);
  });

  it("문서가 hidden이면 활성 작업도 polling하지 않는다", () => {
    expect(activeAdminPollingInterval(true, "hidden")).toBe(false);
  });
});
