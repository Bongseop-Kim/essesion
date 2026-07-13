/** Production builds validate these values in vite.config.ts. */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY ?? "";

export const E2E_MOCK_TOSS =
  import.meta.env.DEV && import.meta.env.VITE_E2E_MOCK_TOSS === "true";
