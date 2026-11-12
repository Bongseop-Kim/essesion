/** Production builds validate these values in vite.config.ts. */
// ponytail: 도메인 이전 동시 운영 동안만 쓰는 분기 — essesion.com으로 접속하면 같은 등록
// 도메인의 api를 부른다(refresh 쿠키가 SameSite=Lax라 교차 사이트면 로그인이 안 된다).
// 전환 정리 때 지우고 빌드 시 고정값으로 되돌린다 (docs/plans/domain-move-essesion-com.md E-2).
const ON_NEW_DOMAIN =
  typeof window !== "undefined" && window.location.hostname === "essesion.com";

export const API_BASE_URL = ON_NEW_DOMAIN
  ? "https://api.essesion.com"
  : (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000");

export const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY ?? "";

export const E2E_MOCK_TOSS =
  import.meta.env.DEV && import.meta.env.VITE_E2E_MOCK_TOSS === "true";
