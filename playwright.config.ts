import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import fs from "fs";
import path from "path";

// Load root .env so API server has all required env vars
config({ path: path.resolve(__dirname, ".env") });

/**
 * Use a system-installed Chromium when one is present, instead of Playwright's
 * downloaded browser bundle. Set PLAYWRIGHT_CHROMIUM_PATH to override.
 *
 * Resolution is deliberately "system if present, else fall back to the bundled
 * download": CI runners have no /usr/bin/chromium, so they keep using
 * `playwright install` as before and this stays a no-op there.
 */
// CI is deliberately excluded from auto-detection: GitHub's ubuntu-latest runners ship
// Chrome at /usr/bin/google-chrome-stable, and silently preferring it over Playwright's
// pinned download would swap the browser out from under the release gate. On CI we only
// honour an explicit PLAYWRIGHT_CHROMIUM_PATH.
const SYSTEM_CHROMIUM_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  ...(process.env.CI
    ? []
    : [
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
      ]),
].filter((p): p is string => typeof p === "string" && p.length > 0);

const systemChromium = SYSTEM_CHROMIUM_CANDIDATES.find((p) => fs.existsSync(p));

// Spread into `use` — an empty object leaves Playwright's default resolution intact.
const chromiumLaunch = systemChromium ? { launchOptions: { executablePath: systemChromium } } : {};

/**
 * Playwright E2E Test Configuration for PantryRadar Web App
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
    // CI runners default to UTC; the developer's machine is America/New_York.
    // Pin one zone so date-boundary behavior is consistent across environments.
    timezoneId: "America/New_York",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        ...chromiumLaunch,
      },
      testMatch: [
        "auth.spec.ts",
        "inventory.spec.ts",
        "barcode.spec.ts",
        "receipt.spec.ts",
        "offline.spec.ts",
        "settings.spec.ts",
        "mealplan.spec.ts",
        "a11y.spec.ts",
        "visual.spec.ts",
        "ui-improvements.spec.ts",
      ],
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"], ...chromiumLaunch },
      testMatch: [
        "auth.spec.ts",
        "inventory.spec.ts",
        "mobile.spec.ts",
        "mealplan.spec.ts",
        "a11y.spec.ts",
        "visual.spec.ts",
      ],
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
        ...(process.env as Record<string, string>),
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
