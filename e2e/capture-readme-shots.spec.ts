/**
 * Not a test — a one-off capture script for the README screenshots in `docs/images/`.
 *
 * Excluded from both Playwright projects' `testMatch` allow-lists, so it never runs in
 * CI or a normal `pnpm test:e2e`. Run it deliberately against a seeded local stack:
 *
 *   npx pnpm exec playwright test capture-readme-shots.spec.ts \
 *     --project=chromium --workers=1 --timeout=60000
 *
 * Requires the dev stack up (API :3000, web :5173) and the two seeded accounts below.
 * The settings shot deliberately uses a household holding an obviously-fake key so no
 * real credential — not even a masked last-4 — ends up in a public image.
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";

const SHOTS = path.resolve(__dirname, "../docs/images");

const PLAN_USER = { email: "devtest@localhost.test", password: "PantryDev!2026" };
const DEMO_USER = { email: "attacker+dev@example.com", password: "OtherPassw0rd!23" };

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/inventory/, { timeout: 20_000 });
}

test("capture README screenshots", async ({ page }) => {
  await signIn(page, PLAN_USER);

  // 1. Inventory — the core surface
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/inventory.png` });

  // 2. Meal plan — the multi-day stack
  await page.goto("/meal-plan");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/meal-plan.png` });

  // 3. Recipe detail sheet. Meal cards are real <a> links (see MealCard.tsx), so this
  // navigates to the route-backed sheet rather than clicking a synthetic control.
  const recipeLink = page.locator('a[href^="/meal-plan/recipe/"]').first();
  await recipeLink.waitFor({ state: "visible", timeout: 15_000 });
  await recipeLink.click();
  await page.waitForURL(/\/meal-plan\/recipe\//, { timeout: 15_000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}/recipe-sheet.png` });

  // Back to the plan, then open the aggregated buy list.
  await page.goto("/meal-plan");
  await page.waitForTimeout(1800);
  const buyList = page.getByRole("button", { name: /to buy/i }).first();
  await buyList.waitFor({ state: "visible", timeout: 15_000 });
  await buyList.click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}/buy-list.png` });

  expect(true).toBe(true);
});

test("capture settings screenshot (fake-key household)", async ({ page }) => {
  await signIn(page, DEMO_USER);
  await page.goto("/settings#ai");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/settings-ai.png`, fullPage: true });
  expect(true).toBe(true);
});
