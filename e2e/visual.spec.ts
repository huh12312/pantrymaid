import { test, expect } from "@playwright/test";
import { registerAs } from "./helpers";
import { TEST_USER } from "./fixtures";
import { stubMealPlanApi } from "./mealplan-helpers";

/**
 * Visual regression snapshots for representative pages.
 *
 * Snapshots live under e2e/visual.spec.ts-snapshots/ keyed by Playwright project
 * name (so we get separate baselines for desktop "chromium" and "Mobile Chrome").
 *
 * The invite code element is masked because it changes per registration.
 *
 * Gated behind RUN_VISUAL=1 so CI doesn't fail on the first run before
 * baselines are committed. Workflow:
 *   1. pnpm test:e2e:update-snapshots  (locally, with stack running)
 *   2. git add e2e/visual.spec.ts-snapshots && git commit
 *   3. flip RUN_VISUAL=1 in the e2e workflow once baselines are in
 */

test.skip(
  !process.env.RUN_VISUAL,
  "Set RUN_VISUAL=1 to run visual regression (requires committed baselines)"
);

test.describe("Visual regression", () => {
  test("login page", async ({ page }) => {
    await page.goto("/login");
    // Wait for fonts so type metrics stabilise before snapshot.
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("login.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("inventory page", async ({ page }) => {
    const user = {
      ...TEST_USER,
      email: `visual+${Date.now()}@pantrymaid.test`,
    };
    await registerAs(page, user);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("inventory.png", {
      fullPage: true,
      animations: "disabled",
      mask: [page.locator('[data-testid="invite-code"]')],
    });
  });

  // Plan §8: "no" to visual snapshots of plan content — model-generated text of
  // variable length is exactly the surface that produces cross-platform pixel churn.
  // The ONE exception is this static, fully code-authored empty/unconfigured state
  // (`AiSetupPrompt` — no AI key saved yet, so there is no plan and nothing the model
  // wrote). Do not add a second meal-plan snapshot without re-reading that rationale.
  test("meal plan page — unconfigured (no AI key) empty state", async ({ page }) => {
    const user = {
      ...TEST_USER,
      email: `visual-mealplan-empty+${Date.now()}@pantrymaid.test`,
    };
    await registerAs(page, user);
    await stubMealPlanApi(page, { keyConfigured: false, initialPlanExists: false });

    await page.goto("/meal-plan");
    await expect(page.getByRole("heading", { name: "Set up AI meal planning" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("meal-plan-unconfigured.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
