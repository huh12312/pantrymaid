import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import path from "path";

// Load root .env so API server has all required env vars
config({ path: path.resolve(__dirname, ".env") });

/**
 * Playwright E2E Test Configuration for PantryMaid Web App
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  outputDir: "playwright-report/",

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    // API server — always started fresh so NODE_ENV is controlled
    {
      command: "bun run src/index.ts",
      cwd: "./server",
      url: "http://localhost:3000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      env: {
        ...process.env as Record<string, string>,
        NODE_ENV: "test",
        PORT: "3000",
      },
    },
    // Web dev server — auto-started, reused if already running locally
    {
      command: "pnpm --filter @pantrymaid/web dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});
