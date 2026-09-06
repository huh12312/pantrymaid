import { test, expect } from "@playwright/test";
import { registerAs, revealManualBarcodeEntry } from "./helpers";
import { TEST_USER, BARCODE_MOCK } from "./fixtures";

test.describe("Barcode Scanning Flow", () => {
  test.describe("Camera Access", () => {
    test("should show camera view or unavailable message when scanner opens", async ({
      page,
      context,
    }) => {
      const uniqueUser = {
        ...TEST_USER,
        email: `barcode-cam+${Date.now()}@pantrymaid.test`,
      };
      await registerAs(page, uniqueUser);

      // Grant camera permission (headless has no real camera so getUserMedia will still fail,
      // but we verify the component handles both states gracefully)
      await context.grantPermissions(["camera"]);
      await page.click('button:has-text("Scan")');
      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

      // Either the video element is present (camera started) or the error message is shown
      const videoOrError = page.locator('video, [class*="muted"]:has-text("Camera unavailable")');
      await expect(videoOrError.first()).toBeVisible({ timeout: 5000 });
    });

    test("should show manual entry when camera is unavailable", async ({ page, context }) => {
      const uniqueUser = {
        ...TEST_USER,
        email: `barcode-deny+${Date.now()}@pantrymaid.test`,
      };
      await registerAs(page, uniqueUser);

      // Deny camera — getUserMedia will reject, triggering the error state
      await context.clearPermissions();
      await page.click('button:has-text("Scan")');
      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

      // Manual entry form is always visible regardless of camera state
      await expect(page.locator('label[for="manual-barcode"]')).toBeVisible({ timeout: 5000 });
      await expect(page.locator("input#manual-barcode")).toBeVisible();
    });
  });

  test.describe("Barcode Scan", () => {
    test("should open barcode scanner dialog", async ({ page }) => {
      const uniqueUser = {
        ...TEST_USER,
        email: `barcode+${Date.now()}@pantrymaid.test`,
      };
      await registerAs(page, uniqueUser);

      await page.click('button:has-text("Scan")');
      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
    });

    test.skip("should scan barcode and fetch product info", async ({ page }) => {
      // Requires real camera / injected video frame — covered by unit tests
    });
  });

  test.describe("Manual Entry", () => {
    test("should look up product via manual barcode entry", async ({ page }) => {
      const uniqueUser = {
        ...TEST_USER,
        email: `barcode-manual+${Date.now()}@pantrymaid.test`,
      };
      await registerAs(page, uniqueUser);

      // Mock the barcode lookup so the test is deterministic
      await page.route(`**/api/barcode/${BARCODE_MOCK.upc}`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: {
              name: BARCODE_MOCK.name,
              brand: BARCODE_MOCK.brand,
              category: BARCODE_MOCK.category,
            },
          }),
        });
      });

      await page.click('button:has-text("Scan")');
      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

      // Manual entry is collapsed behind a reveal control until the user asks
      // for it (camera-first, no surprise keyboard) — open it before filling.
      await revealManualBarcodeEntry(page);
      await page.fill("input#manual-barcode", BARCODE_MOCK.upc);
      await page.click('button[type="submit"]');

      // Scanner sheet closes and add-item dialog opens with product pre-filled
      await expect(page.locator("input#name")).toHaveValue(BARCODE_MOCK.name, {
        timeout: 5000,
      });
    });

    test("should allow adding item manually when barcode is not found", async ({ page }) => {
      const uniqueUser = {
        ...TEST_USER,
        email: `barcode-notfound+${Date.now()}@pantrymaid.test`,
      };
      await registerAs(page, uniqueUser);

      await page.route("**/api/barcode/**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: false, data: null, error: "Not found" }),
        });
      });

      await page.click('button:has-text("Scan")');
      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

      await revealManualBarcodeEntry(page);
      await page.fill("input#manual-barcode", "9999999999999");
      await page.click('button[type="submit"]');

      // Add-item dialog still opens — user can fill name manually.
      // Scope to the specific dialog: the closing scanner sheet briefly remains
      // mounted, so a bare [role="dialog"] can match two elements mid-transition.
      await expect(page.getByRole("dialog", { name: "Add New Item" })).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test.describe("Add Item from Scan", () => {
    test("should add item using manual barcode entry end-to-end", async ({ page }) => {
      const uniqueUser = {
        ...TEST_USER,
        email: `barcode-e2e+${Date.now()}@pantrymaid.test`,
      };
      await registerAs(page, uniqueUser);

      await page.route(`**/api/barcode/${BARCODE_MOCK.upc}`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: {
              name: BARCODE_MOCK.name,
              brand: BARCODE_MOCK.brand,
              category: BARCODE_MOCK.category,
            },
          }),
        });
      });

      await page.click('button:has-text("Scan")');
      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

      await revealManualBarcodeEntry(page);
      await page.fill("input#manual-barcode", BARCODE_MOCK.upc);
      await page.click('button[type="submit"]');

      // Wait for product name to be pre-filled in add-item dialog
      await expect(page.locator("input#name")).toHaveValue(BARCODE_MOCK.name, {
        timeout: 5000,
      });

      // Submit the item
      await page.click('button:has-text("Add Item")');

      // Item appears in the inventory
      await expect(page.getByText(BARCODE_MOCK.name)).toBeVisible({ timeout: 5000 });
    });

    test.skip("should scan barcode from camera and add item", async ({ page }) => {
      // Requires injected video frame — covered by unit tests
    });
  });
});
