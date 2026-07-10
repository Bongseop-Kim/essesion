/** FastAPI api 오리진. Cloudflare 환경변수 VITE_API_BASE_URL, 미설정 시 로컬 기본값. */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
