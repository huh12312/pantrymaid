/**
 * Standalone config for the one-off README screenshot capture.
 *
 * The main `playwright.config.ts` uses per-project `testMatch` ALLOW-LISTS, so a spec
 * that isn't listed there collects zero tests and silently "passes". Rather than adding
 * the capture script to those lists (where it would then run in CI), it gets its own
 * config:
 *
 *   npx pnpm exec playwright test --config playwright.capture.config.ts
 *
 * Requires a seeded local stack: API :3000, web :5173.
 */
import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import fs from "fs";
import path from "path";

config({ path: path.resolve(__dirname, ".env") });

const SYSTEM_CHROMIUM = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
].filter((p): p is string => !!p);

const systemChromium = SYSTEM_CHROMIUM.find((p) => fs.existsSync(p));

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["capture-readme-shots.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: "line",
  outputDir: "playwright-report/capture",
  use: {
    baseURL: "http://localhost:5173",
    timezoneId: "America/New_York",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // retina-quality images for the README
    ...devices["Desktop Chrome"],
    ...(systemChromium ? { launchOptions: { executablePath: systemChromium } } : {}),
  },
});
