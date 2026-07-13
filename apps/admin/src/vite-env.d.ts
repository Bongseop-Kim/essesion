/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** FastAPI api 오리진. Production build에서는 필수. */
  readonly VITE_API_BASE_URL?: string;
}
