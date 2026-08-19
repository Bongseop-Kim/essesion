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
  /** PostHog project API key(phc_...). 없으면 product-analytics 모듈은 no-op이다.
   * 클라이언트 번들에 박히는 공개 키라 시크릿이 아니다. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog ingestion 호스트. 미지정 시 US 리전(https://us.i.posthog.com). */
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
