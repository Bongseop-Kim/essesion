import { describe, expect, it } from "vitest";

import { AUTH_PROVIDERS } from "./providers";

describe("AUTH_PROVIDERS", () => {
  it("api의 OAuthProvider 4종을 모두 노출한다", () => {
    expect(AUTH_PROVIDERS.map((p) => p.id).sort()).toEqual([
      "apple",
      "google",
      "kakao",
      "naver",
    ]);
  });

  // 콘솔 미등록 provider는 OAuth로 보내면 provider 오류로 끝난다 —
  // 4종 모두 콘솔 등록이 끝나 게이팅 없이 실제 로그인으로 가야 한다.
  it("모든 provider가 게이팅 없이 바로 로그인한다", () => {
    expect(AUTH_PROVIDERS.filter((p) => p.comingSoon)).toEqual([]);
  });
});
