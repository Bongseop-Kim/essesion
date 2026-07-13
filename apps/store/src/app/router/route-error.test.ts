import { describe, expect, it } from "vitest";

import { routeErrorDescription } from "./error-description";

describe("routeErrorDescription", () => {
  it("예상하지 못한 렌더 오류에 안전한 안내를 반환한다", () => {
    expect(routeErrorDescription(new Error("secret detail"))).toBe(
      "예상하지 못한 오류가 발생했습니다.",
    );
  });
});
