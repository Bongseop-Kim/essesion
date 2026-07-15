import { defineConfig, devices } from "@playwright/test";

const adminBaseUrl = "http://localhost:3001";
const storeBaseUrl = "http://localhost:3000";
const apiBaseUrl = "http://localhost:8000";
const isCi = process.env.CI === "true";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  workers: 1,
  reporter: isCi
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "uv run uvicorn api.main:app --host 0.0.0.0 --port 8000",
      url: `${apiBaseUrl}/healthz`,
      reuseExistingServer: !isCi,
      timeout: 120_000,
      env: {
        ADMIN_FRONTEND_ORIGIN: adminBaseUrl,
        FRONTEND_ORIGIN: storeBaseUrl,
      },
    },
    {
      command:
        "pnpm --filter admin dev --host 0.0.0.0 --port 3001 --strictPort",
      url: adminBaseUrl,
      reuseExistingServer: !isCi,
      timeout: 120_000,
      env: {
        VITE_API_BASE_URL: apiBaseUrl,
      },
    },
    {
      command: "pnpm --filter store dev --host 0.0.0.0",
      url: storeBaseUrl,
      reuseExistingServer: !isCi,
      timeout: 120_000,
      env: {
        VITE_API_BASE_URL: apiBaseUrl,
        VITE_E2E_MOCK_TOSS: "true",
        VITE_TOSS_CLIENT_KEY: "test_e2e_client_key",
      },
    },
  ],
  projects: [
    {
      name: "admin-chromium",
      testMatch: /admin-smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: adminBaseUrl },
    },
    {
      name: "store-chromium",
      testMatch: /store-money-path\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: storeBaseUrl },
    },
  ],
});
