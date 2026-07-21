import { describe, expect, it } from "vitest";

import {
  DESIGN_ERROR_MESSAGES,
  designErrorMessage,
  parseDesignError,
} from "./errors";

describe("parseDesignError", () => {
  it.each([
    "insufficient_tokens",
    "refund_pending",
    "worker_rejected",
    "authoring_invalid",
    "constraint_conflict",
    "reference_invalid",
    "intent_invalid",
    "candidate_invalid",
    "finalize_quota_exhausted",
    "conflict",
    "upstream_error",
  ] as const)("%s 코드를 사용자 분기로 변환한다", (code) => {
    expect(parseDesignError({ code, detail: "서버 상세" })).toEqual({
      kind: code,
      code,
      detail: "서버 상세",
      message: DESIGN_ERROR_MESSAGES[code],
    });
  });

  it("알 수 없는 코드와 잘못된 detail을 안전한 기본 메시지로 바꾼다", () => {
    expect(parseDesignError({ code: "new_error", detail: [] })).toEqual({
      kind: "unknown",
      code: "new_error",
      detail: null,
      message: DESIGN_ERROR_MESSAGES.unknown,
    });
    expect(parseDesignError(new Error("network"))).toEqual({
      kind: "unknown",
      code: null,
      detail: null,
      message: DESIGN_ERROR_MESSAGES.unknown,
    });
  });

  it("서버 detail이 잘못돼도 코드별 사용자 메시지를 유지한다", () => {
    expect(
      parseDesignError({
        code: "refund_pending",
        detail: "디자인 토큰이 부족합니다",
      }).message,
    ).toBe(DESIGN_ERROR_MESSAGES.refund_pending);
  });

  it("helper 요청은 API detail과 일반 Error 메시지를 보존한다", () => {
    expect(
      designErrorMessage(
        { code: "user_motif_limit", detail: "내 모티프는 최대 100개입니다." },
        "폴백",
      ),
    ).toBe("내 모티프는 최대 100개입니다.");
    expect(designErrorMessage(new Error("네트워크 오류"), "폴백")).toBe(
      "네트워크 오류",
    );
    expect(designErrorMessage({ detail: [] }, "폴백")).toBe("폴백");
  });
});
