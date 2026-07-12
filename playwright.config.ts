import { defineConfig, devices } from "@playwright/test";

const adminBaseUrl = "http://localhost:3001";
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
    baseURL: adminBaseUrl,
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
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
