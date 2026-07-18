/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** FastAPI api 오리진. Production build에서는 필수. */
  readonly VITE_API_BASE_URL?: string;
  /** Toss PaymentWidget 공개 client key. Production build에서는 필수. */
  readonly VITE_TOSS_CLIENT_KEY?: string;
  /** Playwright 로컬 돈 경로 전용 Toss redirect adapter. Production에서는 무시됨. */
  readonly VITE_E2E_MOCK_TOSS?: string;
  /** Sentry browser DSN. 없으면 관측 모듈은 no-op이다. */
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  /** GA4 측정 ID(G-XXXX). 없으면 analytics 모듈은 no-op이다. */
  readonly VITE_GA_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
