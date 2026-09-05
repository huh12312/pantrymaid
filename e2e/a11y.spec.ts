import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { registerAs } from "./helpers";
import { TEST_USER } from "./fixtures";
import { stubMealPlanApi } from "./mealplan-helpers";

/**
 * Axe accessibility checks. Runs on both the desktop "chromium" project
 * and the "Mobile Chrome" Pixel 5 project so we catch responsive regressions.
 *
 * The wcag2a/wcag2aa tag set is the meaningful baseline. We deliberately
 * exclude `color-contrast` for now: the dark-mode tokens occasionally trip
 * AA thresholds during transitions and we'd rather audit them deliberately.
 */

const baseTags = ["wcag2a", "wcag2aa"];

const buildAxe = (page: Parameters<Parameters<typeof test>[1]>[0]["page"]) =>
  new AxeBuilder({ page }).withTags(baseTags).disableRules(["color-contrast"]);

test.describe("Accessibility", () => {
  test("login page has no axe violations", async ({ page }) => {
    await page.goto("/login");
    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  test("inventory page has no axe violations", async ({ page }) => {
    const user = {
      ...TEST_USER,
      email: `a11y-inventory+${Date.now()}@pantrymaid.test`,
    };
    await registerAs(page, user);
    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  test("add item dialog has no axe violations", async ({ page, isMobile }) => {
    const user = {
      ...TEST_USER,
      email: `a11y-add+${Date.now()}@pantrymaid.test`,
    };
    await registerAs(page, user);
    // FAB is md:hidden on desktop; section buttons exist on desktop only
    if (isMobile) {
      await page.getByTestId("mobile-fab").click();
    } else {
      await page
        .getByTestId("section-pantry")
        .getByRole("button", { name: /add item to pantry/i })
        .click();
    }
    await expect(page.getByText("Add New Item")).toBeVisible();
    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });
});

/**
 * Meal-plan accessibility coverage (docs/plans/meal-planning.md §8: "extend
 * e2e/a11y.spec.ts with the plan page, the open recipe sheet, the open shopping
 * sheet, and the AI settings section"). The LLM is stubbed exactly as in
 * `mealplan.spec.ts` — see that file's header comment for the two-layer strategy.
 *
 * Two things axe cannot catch are asserted directly, not via `buildAxe`: the
 * generating-state `aria-live="polite"` announcement (axe has no way to know whether
 * a live region ever actually gets populated), and day-rail keyboard reachability
 * with `aria-current` tracking (axe checks static ARIA correctness, not that a
 * keyboard interaction actually moves state).
 */
test.describe("Meal planning accessibility", () => {
  test("meal plan page (with a materialized 7-day plan) has no axe violations", async ({
    page,
  }) => {
    const user = { ...TEST_USER, email: `a11y-mealplan+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page);

    await page.goto("/meal-plan");
    await expect(page.locator("section[data-day-index]")).toHaveCount(7, { timeout: 10000 });

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  test("the open recipe sheet has no axe violations", async ({ page }) => {
    const user = { ...TEST_USER, email: `a11y-recipesheet+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page);

    await page.goto("/meal-plan");
    await page.getByRole("link", { name: /Sheet-Pan Lemon Chicken with Broccoli/ }).click();
    await expect(
      page.getByRole("heading", { name: "Sheet-Pan Lemon Chicken with Broccoli", level: 2 })
    ).toBeVisible();

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  test("the open plan shopping sheet has no axe violations", async ({ page }) => {
    const user = { ...TEST_USER, email: `a11y-shoppingsheet+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page);

    await page.goto("/meal-plan");
    await page.getByRole("button", { name: /to buy/ }).click();
    await expect(page.getByRole("heading", { name: "Buy List" })).toBeVisible();

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  test("the AI settings section has no axe violations", async ({ page }) => {
    const user = { ...TEST_USER, email: `a11y-aisettings+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "AI Meal Planning" })).toBeVisible();

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  test('the generating state announces via aria-live="polite"', async ({ page }) => {
    const user = { ...TEST_USER, email: `a11y-generating+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    // `simulateGeneratingDelay` makes the FIRST poll after POST return an in-progress
    // snapshot (days: []) — an instant "ready" response never renders
    // `GenerationProgress` at all, so this is the only way to reach the live region
    // (see `mealplan-helpers.ts`'s doc comment on the option).
    await stubMealPlanApi(page, { initialPlanExists: false, simulateGeneratingDelay: true });

    await page.goto("/meal-plan");
    await page.getByRole("button", { name: "Generate meal plan" }).click();

    const liveRegion = page.getByRole("status");
    await expect(liveRegion).toBeVisible({ timeout: 10000 });
    await expect(liveRegion).toHaveAttribute("aria-live", "polite");
    await expect(liveRegion).toContainText(/of \d+ meals ready|Getting started/);
  });

  test("the day-jump rail is keyboard-reachable and aria-current tracks the visible day", async ({
    page,
  }) => {
    const user = { ...TEST_USER, email: `a11y-dayrail+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page);

    await page.goto("/meal-plan");
    await expect(page.locator("section[data-day-index]")).toHaveCount(7, { timeout: 10000 });

    const rail = page.getByRole("navigation", { name: "Jump to day" });
    const railButtons = rail.getByRole("button");
    await expect(railButtons).toHaveCount(7);

    // None of the fixture's dates match "today", so the page anchors to day 0 on
    // mount (`MealPlanPage`'s anchor-to-today effect falls back to `dayViewModels[0]`).
    await expect(railButtons.nth(0)).toHaveAttribute("aria-current", "true");

    // Plain <button> elements need no extra wiring to be keyboard-focusable/activatable —
    // Tab-equivalent `.focus()` plus a native Enter keypress exercises exactly the same
    // path a real keyboard user takes.
    await railButtons.nth(3).focus();
    await expect(railButtons.nth(3)).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(railButtons.nth(3)).toHaveAttribute("aria-current", "true");
    await expect(railButtons.nth(0)).not.toHaveAttribute("aria-current", "true");
  });
});
