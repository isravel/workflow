import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: externalBaseURL ?? "http://127.0.0.1:3100",
    trace: "on-first-retry",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /pwa\.spec\.ts/,
    },
    {
      name: "pwa",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /pwa\.spec\.ts/,
    },
  ],
  ...(externalBaseURL ? {} : {
    webServer: {
      command: process.env.PWA_E2E === "1"
        ? "node scripts/static-server.mjs --port=3100"
        : "npm run dev -- --hostname 127.0.0.1 --port 3100",
      env: {
        NEXT_PUBLIC_ACTIVITY_API_URL: "",
      },
      url: "http://127.0.0.1:3100",
      reuseExistingServer: !process.env.CI && process.env.PWA_E2E !== "1",
      timeout: 120_000,
    },
  }),
});
