/**
 * Separate config for the fake-camera barcode validation.
 *
 * Kept out of `playwright.config.ts` on purpose: this spec launches its own Chromium with
 * `--use-fake-device-for-media-stream` and needs a ~60MB generated y4m feed, neither of
 * which belongs in the standard CI suite. The main config's per-project `testMatch`
 * allow-lists would exclude it anyway.
 *
 *   ./scripts/make-fake-camera-video.sh
 *   npx pnpm exec playwright test --config playwright.camera.config.ts
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["barcode-camera.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: "line",
  outputDir: "playwright-report/camera",
});
