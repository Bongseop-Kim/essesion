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
  // 안내 문구가 있는 항목만 게이팅되고, 나머지는 실제 로그인으로 가야 한다.
  it("네이버만 준비 중 안내를 갖고 나머지는 바로 로그인한다", () => {
    const gated = AUTH_PROVIDERS.filter((p) => p.comingSoon);

    expect(gated.map((p) => [p.id, p.comingSoon])).toEqual([
      ["naver", expect.stringContaining("준비 중")],
    ]);
  });
});
