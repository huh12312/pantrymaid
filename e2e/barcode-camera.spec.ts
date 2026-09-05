/**
 * Fake-camera validation for the barcode scanner's resolution fix.
 *
 * The reported bug ("1x zoom won't scan on Android, must use 2x") was NOT a zoom
 * problem: @zxing/browser's `decodeFromVideoDevice(undefined, ...)` requests only
 * `{facingMode:'environment'}` with no resolution hint, so Chrome negotiated a low
 * default (commonly 640x480) and a UPC filling ~20% of the frame left each bar about a
 * pixel wide — under the decode threshold.
 *
 * jsdom has no camera, so unit tests can only assert the constraint OBJECT we build.
 * This spec drives real Chromium against synthetic cameras instead, and covers both the
 * bug and the fix:
 *
 *   1. OLD constraints negotiate exactly 640x480 — the defect, reproduced.
 *   2. NEW constraints negotiate >=1920x1080 — the fix, measured.
 *   3. The REAL scanner component decodes a barcode occupying only ~21% of frame width,
 *      i.e. the 1x-zoom framing that fails on a phone. Deliberately not a barcode filling
 *      the viewport, which would decode even at 640x480 and prove nothing.
 *
 * What this canNOT prove: which physical lens a given multi-camera Android device selects,
 * or that a real sensor honors `ideal: 2560` the way Chromium's synthetic one does. Those
 * still need the actual handset.
 *
 * Run with a separate config (it needs browser launch flags the main suite must not get):
 *   ./scripts/make-fake-camera-video.sh
 *   npx pnpm exec playwright test --config playwright.camera.config.ts
 */
import { test, expect, chromium, type Browser } from "@playwright/test";
import fs from "fs";
import path from "path";

const FEED = path.resolve(__dirname, "fixtures/barcode-camera-1080p.y4m");
const EXPECTED_UPC = "049000006346";
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
// Seeded local dev account (see README dev setup); overridable for other environments.
const APP_USER = {
  email: process.env.APP_USER_EMAIL ?? "devtest@localhost.test",
  password: process.env.APP_USER_PASSWORD ?? "PantryDev!2026",
};

// The exact constraints the app now requests (see apps/web/src/lib/barcodeCamera.ts) and
// the ones it used to get implicitly from @zxing/browser.
const NEW_CONSTRAINTS = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 2560 },
    height: { ideal: 1440 },
  },
};
const OLD_CONSTRAINTS = { video: { facingMode: "environment" } };

/** Same system-Chromium resolution the main config uses; falls back to the bundled build. */
const SYSTEM_CHROMIUM = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
].filter((p): p is string => !!p && fs.existsSync(p))[0];

/**
 * TWO different synthetic cameras are needed, because they behave differently:
 *
 * - `pattern`: Chromium's generated test pattern. It HONORS resolution constraints, so it
 *   models a real camera's negotiation. Measured behavior: no hint -> 640x480,
 *   `ideal: 2560` -> 2560x1440. This is what proves the fix.
 * - `file`: plays a y4m file and always emits the file's native size, IGNORING resolution
 *   constraints. Useless for negotiation assertions (both old and new yield 1920x1080),
 *   but it's the only way to put a REAL barcode in front of the decoder.
 */
async function launchFakeCamera(kind: "pattern" | "file"): Promise<Browser> {
  return chromium.launch({
    ...(SYSTEM_CHROMIUM ? { executablePath: SYSTEM_CHROMIUM } : {}),
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...(kind === "file" ? [`--use-file-for-fake-video-capture=${FEED}`] : []),
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
}

/** Opens a stream with the given constraints and reports the resolution actually negotiated. */
async function negotiatedResolution(
  browser: Browser,
  constraints: MediaStreamConstraints
): Promise<{ width: number; height: number }> {
  const page = await browser.newPage();
  // Must be a secure context — `navigator.mediaDevices` is undefined on about:blank.
  // http://localhost counts as secure, so the dev server origin works.
  await page.goto(APP_URL);
  const result = await page.evaluate(async (c) => {
    const stream = await navigator.mediaDevices.getUserMedia(c as MediaStreamConstraints);
    const s = stream.getVideoTracks()[0].getSettings();
    stream.getTracks().forEach((t) => t.stop());
    return { width: s.width ?? 0, height: s.height ?? 0 };
  }, constraints as unknown as Record<string, unknown>);
  await page.close();
  return result;
}

test.describe("barcode scanner — fake camera", () => {
  test.skip(!fs.existsSync(FEED), `missing ${FEED} — run ./scripts/make-fake-camera-video.sh`);

  let patternCam: Browser;
  let fileCam: Browser;
  test.beforeAll(async () => {
    patternCam = await launchFakeCamera("pattern");
    fileCam = await launchFakeCamera("file");
  });
  test.afterAll(async () => {
    await patternCam?.close();
    await fileCam?.close();
  });

  test("the OLD constraints reproduce the 640x480 bug", async () => {
    // The original defect, reproduced: with no resolution hint Chrome negotiates VGA, at
    // which a barcode filling ~20% of the frame is about one pixel per bar — under the
    // decode threshold. This is the measurement that makes the next test meaningful.
    const res = await negotiatedResolution(patternCam, OLD_CONSTRAINTS);
    expect(res).toEqual({ width: 640, height: 480 });
  });

  test("our constraints negotiate a high-resolution stream", async () => {
    const { width, height } = await negotiatedResolution(patternCam, NEW_CONSTRAINTS);
    expect(width).toBeGreaterThanOrEqual(1920);
    expect(height).toBeGreaterThanOrEqual(1080);
  });

  test("the real app scanner decodes a barcode at ~21% of frame width", async () => {
    // Drives the ACTUAL scanner component against the synthetic camera, rather than
    // re-implementing decode in the page — this is what proves the shipped code path
    // reads a barcode that occupies only a fifth of the frame, i.e. the 1x-zoom case.
    const context = await fileCam.newContext({ permissions: ["camera"] });
    const page = await context.newPage();

    // The barcode lookup itself is stubbed: this test is about whether the CAMERA
    // pipeline decodes, not about Open Food Facts' data or an LLM expiry estimate.
    await page.route("**/api/barcode/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { upc: EXPECTED_UPC, name: "Fake Camera Test Product", brand: "Test" },
        }),
      })
    );

    // Resolves as soon as the app requests a lookup for the decoded UPC — that request
    // only happens if the scanner actually read the barcode off the synthetic camera.
    let resolveUpc: (v: string | null) => void;
    const scanned = new Promise<string | null>((r) => (resolveUpc = r));
    page.on("request", (req) => {
      const m = /\/api\/barcode\/(\d+)/.exec(req.url());
      if (m) resolveUpc(m[1]!);
    });

    await page.goto(`${APP_URL}/login`);
    await page.fill("#email", APP_USER.email);
    await page.fill("#password", APP_USER.password);
    await page.click('button:has-text("Sign In")');
    await page.waitForURL(/\/inventory/, { timeout: 20_000 });
    await page.getByRole("button", { name: /scan/i }).first().click();

    const scannedUpc = await Promise.race([
      scanned,
      new Promise<null>((r) => setTimeout(() => r(null), 30_000)),
    ]);

    await context.close();
    expect(scannedUpc).toBe(EXPECTED_UPC);
  });
});
