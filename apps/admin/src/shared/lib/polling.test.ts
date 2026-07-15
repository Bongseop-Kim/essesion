import { describe, expect, it } from "vitest";

import {
  activeAdminPollingInterval,
  generationPollingInterval,
  incidentPollingInterval,
} from "./polling";

describe("admin polling", () => {
  it("generation 결과가 terminal-only이면 polling을 중단한다", () => {
    expect(
      generationPollingInterval(
        [{ status: "succeeded" }, { status: "failed" }],
        "visible",
      ),
    ).toBe(false);
    expect(
      generationPollingInterval([{ status: "processing" }], "visible"),
    ).toBe(30_000);
  });

  it("incident 결과가 terminal-only이면 polling을 중단한다", () => {
    expect(incidentPollingInterval([{ status: "resolved" }], "visible")).toBe(
      false,
    );
    expect(incidentPollingInterval([{ status: "open" }], "visible")).toBe(
      30_000,
    );
  });

  it("문서가 hidden이면 활성 작업도 polling하지 않는다", () => {
    expect(activeAdminPollingInterval(true, "hidden")).toBe(false);
  });
});
