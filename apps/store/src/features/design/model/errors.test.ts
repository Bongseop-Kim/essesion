import { describe, expect, it } from "vitest";

import { designErrorMessage } from "./errors";

describe("designErrorMessage", () => {
  it("helper 요청은 API detail만 보존하고 네트워크 원문은 숨긴다", () => {
    expect(
      designErrorMessage(
        { code: "user_motif_limit", detail: "내 모티프는 최대 100개입니다." },
        "폴백",
      ),
    ).toBe("내 모티프는 최대 100개입니다.");
    expect(designErrorMessage(new Error("Failed to fetch"), "폴백")).toBe(
      "폴백",
    );
    expect(designErrorMessage("Failed to fetch", "폴백")).toBe("폴백");
    expect(designErrorMessage({ detail: [] }, "폴백")).toBe("폴백");
  });
});
