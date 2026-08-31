// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  attemptNaverAutologin,
  clearNaverAutologinAttempt,
  consumeNaverAutologinAttempt,
  markNaverLoginUsed,
  suppressNaverAutologin,
} from "./naver-autologin";

const NAVER_APP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS like Mac OS X) AppleWebKit/605.1.15 NAVER(inapp; search; 620; 10.10.2; XR)";
const NORMAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15";

describe("naver autologin", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("네이버앱 UA가 아니면 시도하지 않는다", () => {
    markNaverLoginUsed();
    expect(attemptNaverAutologin(NORMAL_UA)).toBe(false);
  });

  it("네이버 로그인 이력이 없으면 시도하지 않는다 — 미연동 방문자의 리다이렉트 낭비 방지", () => {
    expect(attemptNaverAutologin(NAVER_APP_UA)).toBe(false);
  });

  it("이미 시도한 브라우저 세션에서는 재시도하지 않는다 — 리다이렉트 루프 방지", () => {
    markNaverLoginUsed();
    sessionStorage.setItem("essesion_naver_autologin", "pending");
    expect(attemptNaverAutologin(NAVER_APP_UA)).toBe(false);
  });

  it("자동로그인 시도(pending)만 1회 소진된다 — 수동 로그인 취소는 false", () => {
    expect(consumeNaverAutologinAttempt("naver")).toBe(false); // 시도 없음
    sessionStorage.setItem("essesion_naver_autologin", "pending");
    expect(consumeNaverAutologinAttempt("google")).toBe(false); // 다른 provider는 건드리지 않음
    expect(consumeNaverAutologinAttempt("naver")).toBe(true);
    expect(consumeNaverAutologinAttempt("naver")).toBe(false); // done으로 소진됨
  });

  it("명시적 로그아웃은 다시 네이버 로그인을 누를 때까지 자동로그인을 막는다", () => {
    markNaverLoginUsed();
    suppressNaverAutologin();
    expect(localStorage.getItem("essesion_naver_login_used")).toBeNull();

    markNaverLoginUsed();
    expect(localStorage.getItem("essesion_naver_login_used")).toBe("1");
  });

  it("성공한 네이버 콜백만 pending 상태를 지운다", () => {
    sessionStorage.setItem("essesion_naver_autologin", "pending");
    clearNaverAutologinAttempt("kakao");
    expect(sessionStorage.getItem("essesion_naver_autologin")).toBe("pending");
    clearNaverAutologinAttempt("naver");
    expect(sessionStorage.getItem("essesion_naver_autologin")).toBeNull();
  });
});
