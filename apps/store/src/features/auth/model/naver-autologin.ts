import { API_BASE_URL } from "@/shared/config/env";

/**
 * 네이버앱 자동로그인 (네이버 로그인 개발가이드 §5.1).
 *
 * 네이버앱 인앱 브라우저에서 접근한 비로그인 방문자 중 과거 네이버 로그인 이력이
 * 있는 경우에만 authorize URL(auth_type=autologin)로 1회 시도한다. 이력 없이
 * 무조건 시도하면 미연동 사용자가 첫 방문마다 access_denied 리다이렉트 왕복을
 * 낭비하므로, 네이버 OAuth를 시작할 때 심는 localStorage 플래그를 조건으로 건다.
 */
const USED_NAVER_KEY = "essesion_naver_login_used";
const ATTEMPT_KEY = "essesion_naver_autologin"; // sessionStorage: "pending" | "done"

// 네이버앱 판별 조건 (개발가이드 §5.1.3 — User-Agent에 이 문자열 포함)
const NAVER_APP_UA = "NAVER(inapp; search;";

/** 네이버 OAuth 시작 시 호출 — 이후 방문에서 자동로그인 시도 대상이 된다. */
export function markNaverLoginUsed(): void {
  try {
    localStorage.setItem(USED_NAVER_KEY, "1");
  } catch {
    // storage 차단 환경 — 자동로그인만 포기
  }
}

/** 명시적 로그아웃 뒤에는 사용자가 다시 네이버 로그인을 누르기 전까지 자동로그인하지 않는다. */
export function suppressNaverAutologin(): void {
  try {
    localStorage.removeItem(USED_NAVER_KEY);
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // storage 차단 환경 — 저장된 자동로그인 상태도 없음
  }
}

/** 세션 부트스트랩이 비로그인으로 끝났을 때 1회 시도. 시도했으면 true(페이지 이탈). */
export function attemptNaverAutologin(
  userAgent: string = navigator.userAgent,
): boolean {
  try {
    if (!userAgent.includes(NAVER_APP_UA)) return false;
    if (localStorage.getItem(USED_NAVER_KEY) !== "1") return false;
    if (sessionStorage.getItem(ATTEMPT_KEY) !== null) return false; // 브라우저 세션당 1회
    sessionStorage.setItem(ATTEMPT_KEY, "pending");
  } catch {
    return false;
  }
  window.location.href = `${API_BASE_URL}/auth/naver/login?auth_type=autologin`;
  return true;
}

/** 콜백이 error를 받았을 때 — 자동로그인 시도였으면 true를 반환하고 소진 처리한다.
 *  true면 조용히 넘어가고(§5.1.5 오류 처리 방안), false면 사용자가 취소한 수동 로그인. */
export function consumeNaverAutologinAttempt(provider: string | null): boolean {
  try {
    if (provider !== "naver") return false;
    if (sessionStorage.getItem(ATTEMPT_KEY) !== "pending") return false;
    sessionStorage.setItem(ATTEMPT_KEY, "done");
    return true;
  } catch {
    return false;
  }
}

export function clearNaverAutologinAttempt(provider: string | null): void {
  if (provider !== "naver") return;
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // storage 차단 환경 — 지울 상태도 없음
  }
}
