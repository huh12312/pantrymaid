import { test, expect } from "@playwright/test";
import { registerAs } from "./helpers";
import { TEST_USER } from "./fixtures";
import { stubMealPlanApi, buildFailedPlan } from "./mealplan-helpers";

/**
 * E2E Tests: Meal Planning (docs/plans/meal-planning.md §5.2, §5.3, §5.4, §5.5, §5.6)
 *
 * The LLM is never actually called here — every meal-plan/settings endpoint is
 * stubbed via `page.route`/`route.fulfill` (`stubMealPlanApi`, following the exact
 * `receipt.spec.ts` idiom). This is Layer 1 of the plan §8 two-layer stub; Layer 2
 * (the `MEAL_PLAN_FIXTURE` server-side hook for real persistence) has no e2e spec
 * of its own in this file — see the server-side unit test
 * `server/src/test/lib/mealplan/generate.fixture-gate.test.ts` for that layer's
 * coverage, and this file's header comment on the "error banner" test below for why
 * a real end-to-end persistence spec needs a running Postgres this environment may
 * not have.
 */

test.describe("Meal Planning", () => {
  test("generates a plan and shows 7 days", async ({ page }) => {
    const user = { ...TEST_USER, email: `mealplan-generate+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page, { initialPlanExists: false });

    await page.goto("/meal-plan");
    await expect(page.getByRole("heading", { name: "Plan your week" })).toBeVisible();

    await page.getByRole("button", { name: "Generate meal plan" }).click();

    // 7 day sections materialize once the (stubbed) plan comes back ready.
    await expect(page.locator("section[data-day-index]")).toHaveCount(7, { timeout: 10000 });

    // Day 0 has two slots (breakfast + dinner) — the multi-slot rendering path.
    await expect(page.getByRole("link", { name: /Fluffy Scrambled Eggs with Toast/ })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Sheet-Pan Lemon Chicken with Broccoli/ })
    ).toBeVisible();

    // The one meal the fixture marks `detailStatus: "failed"` renders its inline retry,
    // not a link (plan §4.1: a plan can be "ready" with individual failed meals).
    await expect(page.getByText("Baked Ziti")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry this recipe" })
    ).toBeVisible();
  });

  test("opens recipe detail and sees numbered instructions", async ({ page }) => {
    const user = { ...TEST_USER, email: `mealplan-recipe+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page);

    await page.goto("/meal-plan");
    await page.getByRole("link", { name: /Sheet-Pan Lemon Chicken with Broccoli/ }).click();

    await expect(page).toHaveURL(/\/meal-plan\/recipe\/meal-0-dinner/);
    await expect(
      page.getByRole("heading", { name: "Sheet-Pan Lemon Chicken with Broccoli", level: 2 })
    ).toBeVisible();

    // Numbered steps: a real <ol> (RecipeInstructions), each fixture step present.
    const sheet = page.locator('[data-testid="sheet-content"]');
    const steps = sheet.locator("ol li");
    await expect(steps).toHaveCount(4);
    await expect(steps.first()).toContainText("Preheat the oven to 425°F");

    // The ingredient source mix from the fixture (plan §5.3 have/buy chips). Scoped to
    // the sheet and exact-matched — "Buy" is otherwise a substring of the page's own
    // "N to buy" summary bar text.
    // The fixture recipe has MORE THAN ONE "Buy" ingredient, so these must assert on a
    // count rather than a single element — a bare getByText trips Playwright's strict
    // mode when the badge legitimately appears twice.
    await expect(sheet.getByText("Have it", { exact: true }).first()).toBeVisible();
    await expect(sheet.getByText("Buy", { exact: true })).not.toHaveCount(0);
    await expect(sheet.getByText("Staple", { exact: true }).first()).toBeVisible();
  });

  test("recipe route deep-links and closing returns to /meal-plan", async ({ page }) => {
    const user = { ...TEST_USER, email: `mealplan-deeplink+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page);

    // A cold deep link — nothing navigated here first, so MealPlanPage's
    // `location.key === "default"` branch is the one under test (plan §5.3: must not
    // blindly `navigate(-1)`, which would exit the app entirely).
    await page.goto("/meal-plan/recipe/meal-0-dinner");
    await expect(
      page.getByRole("heading", { name: "Sheet-Pan Lemon Chicken with Broccoli", level: 2 })
    ).toBeVisible();

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/meal-plan$/);
    await expect(
      page.getByRole("heading", { name: "Sheet-Pan Lemon Chicken with Broccoli", level: 2 })
    ).not.toBeVisible();
  });

  test("the buy list shows must-buy items and commits to the re-order list", async ({ page }) => {
    const user = { ...TEST_USER, email: `mealplan-buylist+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page);

    await page.goto("/meal-plan");

    // Persistent summary bar (plan §5.4: "N ingredients · M to buy").
    const summaryButton = page.getByRole("button", { name: /to buy/ });
    await expect(summaryButton).toBeVisible();
    await summaryButton.click();

    await expect(page.getByRole("heading", { name: "Buy List" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Must buy" })).toBeVisible();
    // A freshly-registered household has no matching inventory, so every non-staple
    // ingredient in the fixture resolves to "must_buy" (`mealPlanIngredients.ts`'s
    // `resolveRowStatus`: no `matchedItemId` match => must_buy, regardless of the
    // server-assigned `source`).
    // Scope to the sheet: an unscoped match also hits the meal card's description text
    // behind the sheet ("Roasted chicken thighs and broccoli…"), which is a strict-mode
    // violation rather than a real failure.
    const buySheet = page.locator('[data-testid="sheet-content"]');
    await expect(buySheet.getByText("Chicken Thigh", { exact: true })).toBeVisible();
    await expect(buySheet.getByText("Ground Beef", { exact: true })).toBeVisible();

    const commitButton = page.getByRole("button", { name: /Add \d+ to Re-order List/ });
    await expect(commitButton).toBeEnabled();
    await commitButton.click();

    await expect(page.getByText(/Added \d+ items? to your re-order list\./)).toBeVisible();
  });

  test("an error banner appears when generation fails", async ({ page }) => {
    const user = { ...TEST_USER, email: `mealplan-error+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);

    // NOTE on "fulfill a 502": a literal HTTP 502 on `POST /api/meal-plans` does NOT
    // surface anywhere in the current UI — `useMealPlanGeneration`'s `startError` is
    // computed but never read by `MealPlanPage` (verified: `grep -rn "startError"
    // apps/web/src` only finds its own definition). A failed *create* request is
    // silently swallowed today; see this task's final report for that gap. The error
    // banner the app DOES render (`MealPlanPage`'s `role="alert"`, driven by
    // `classifyMealPlanError`) fires off a plan whose polled `status` is `"failed"` —
    // exactly how the real server reports a generation failure (POST returns 202,
    // and the failure surfaces on the next `GET /api/meal-plans/:id` poll, still HTTP
    // 200). That's what this test exercises.
    await stubMealPlanApi(page, {
      initialPlanExists: false,
      plan: buildFailedPlan({
        errorCode: "invalid_api_key",
        errorMessage: "The stored API key was rejected by the provider.",
      }),
    });

    await page.goto("/meal-plan");
    await page.getByRole("button", { name: "Generate meal plan" }).click();

    const banner = page.getByRole("alert");
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText("The stored API key was rejected by the provider.");
    // invalid_api_key is the one error kind that links to Settings (plan §5.5).
    await expect(banner.getByRole("link", { name: "Go to Settings" })).toHaveAttribute(
      "href",
      "/settings#ai"
    );
  });

  test("settings saves model + prompt and the key shows masked after reload", async ({ page }) => {
    const user = { ...TEST_USER, email: `mealplan-settings+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page, { keyConfigured: false });

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "AI Meal Planning" })).toBeVisible();

    await page.getByLabel("Provider").click();
    await page.getByRole("option", { name: "OpenAI" }).click();
    // `exact` is required: the AI section also has a "Vision model (receipt OCR)" field
    // (plus its suggestion chips), so a substring label match resolves to 4 elements.
    await page.getByLabel("Model", { exact: true }).fill("gpt-4o-mini");

    await page.getByRole("button", { name: "Add API key" }).click();
    await page.getByLabel("API key").fill("sk-test-1234abcd");

    await page.getByRole("button", { name: "Save AI settings" }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible();

    await page.getByLabel("Custom instructions").fill("Favor sheet-pan dinners for a busy week.");
    await page.getByRole("button", { name: "Save prompt" }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible();

    await page.reload();

    // Masked, never the raw key (plan §5.6/§6.2): "••••" + last 4 of what was saved.
    await expect(page.getByText("••••abcd")).toBeVisible();
    await expect(page.getByRole("button", { name: "Replace" })).toBeVisible();
  });
});
