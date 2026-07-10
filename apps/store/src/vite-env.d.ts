/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** FastAPI api 오리진 (예: http://localhost:8000). 미설정 시 로컬 기본값. */
  readonly VITE_API_BASE_URL?: string;
  /** Toss PaymentWidget 공개 client key. */
  readonly VITE_TOSS_CLIENT_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
