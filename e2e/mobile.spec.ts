import { test, expect } from "@playwright/test";
import { registerAs } from "./helpers";
import { TEST_USER } from "./fixtures";
import { stubMealPlanApi } from "./mealplan-helpers";

/**
 * Mobile-only E2E flows that exercise chrome that only exists below `md`:
 * the segmented top tabs, FAB, overflow menu, and bottom-sheet dialog.
 *
 * Runs against the "Mobile Chrome" Playwright project (Pixel 5).
 */

test.describe("Mobile chrome", () => {
  test("segmented tabs are visible with four roles=tab", async ({ page }) => {
    const user = {
      ...TEST_USER,
      email: `mobile-tabs+${Date.now()}@pantrymaid.test`,
    };
    await registerAs(page, user);

    const tablist = page.getByRole("tablist");
    await expect(tablist).toBeVisible();
    const tabs = tablist.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toContainText(/All/i);
    await expect(tabs.nth(1)).toContainText(/Pantry/i);
    await expect(tabs.nth(2)).toContainText(/Fridge/i);
    await expect(tabs.nth(3)).toContainText(/Freezer/i);
  });

  test("FAB opens the add-item sheet", async ({ page }) => {
    const user = {
      ...TEST_USER,
      email: `mobile-fab+${Date.now()}@pantrymaid.test`,
    };
    await registerAs(page, user);

    await page.getByTestId("mobile-fab").click();
    await expect(page.getByText("Add New Item")).toBeVisible();
    await expect(page.locator('[data-testid="sheet-content"]')).toBeVisible();
  });

  test("overflow menu sign out returns user to login", async ({ page }) => {
    const user = {
      ...TEST_USER,
      email: `mobile-logout+${Date.now()}@pantrymaid.test`,
    };
    await registerAs(page, user);

    await page.getByTestId("overflow-menu-trigger").click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("filter to fridge tab shows only fridge", async ({ page }) => {
    const user = {
      ...TEST_USER,
      email: `mobile-filter+${Date.now()}@pantrymaid.test`,
    };
    await registerAs(page, user);

    // Add a pantry item via the FAB
    await page.getByTestId("mobile-fab").click();
    await page.getByLabel("Name *").fill("Mobile Pantry Item");
    await page.getByRole("button", { name: "Add Item", exact: true }).click();
    await expect(page.getByText("Mobile Pantry Item")).toBeVisible();

    // Add a fridge item, choosing Fridge from the location select
    await page.getByTestId("mobile-fab").click();
    await page.getByLabel("Name *").fill("Mobile Fridge Item");
    await page.getByLabel("Location *").click();
    await page.getByRole("option", { name: /fridge/i }).click();
    await page.getByRole("button", { name: "Add Item", exact: true }).click();
    await expect(page.getByText("Mobile Fridge Item")).toBeVisible();

    // Switch to Fridge tab
    await page.getByRole("tab", { name: /fridge/i }).click();
    await expect(page.getByText("Mobile Fridge Item")).toBeVisible();
    await expect(page.getByText("Mobile Pantry Item")).not.toBeVisible();
  });

  test("overflow menu reveals invite code", async ({ page }) => {
    const user = {
      ...TEST_USER,
      email: `mobile-invite+${Date.now()}@pantrymaid.test`,
    };
    await registerAs(page, user);

    await page.getByTestId("overflow-menu-trigger").click();
    await expect(page.getByText(/invite:/i)).toBeVisible();
  });

  // Plan §5.2 deliberately chose a VERTICAL day stack over horizontal snap-scroll —
  // these two tests exercise exactly that (vertical stacking + sticky headers) and
  // must never grow a horizontal-scroll assertion.
  test("day stack is a vertical scroll, not horizontal snap-scroll", async ({ page }) => {
    const user = { ...TEST_USER, email: `mobile-mealplan-stack+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page);

    await page.goto("/meal-plan");
    await expect(page.locator("section[data-day-index]")).toHaveCount(7, { timeout: 10000 });

    const day0 = page.locator("#meal-plan-day-0-heading");
    const day1 = page.locator("#meal-plan-day-1-heading");
    const day0Box = await day0.boundingBox();
    const day1Box = await day1.boundingBox();
    expect(day0Box).not.toBeNull();
    expect(day1Box).not.toBeNull();

    // Day 1 sits below day 0 (vertical stack), not beside it at the same y (which is
    // what a horizontal snap-scroll layout — explicitly rejected in the plan — would
    // produce instead).
    expect(day1Box!.y).toBeGreaterThan(day0Box!.y + day0Box!.height);
    expect(Math.abs(day1Box!.x - day0Box!.x)).toBeLessThan(5);
  });

  test("day headers stay sticky while scrolling the vertical day stack", async ({ page }) => {
    const user = { ...TEST_USER, email: `mobile-mealplan-sticky+${Date.now()}@pantrymaid.test` };
    await registerAs(page, user);
    await stubMealPlanApi(page);

    await page.goto("/meal-plan");
    await expect(page.locator("section[data-day-index]")).toHaveCount(7, { timeout: 10000 });

    const day0Heading = page.locator("#meal-plan-day-0-heading");
    const day1Heading = page.locator("#meal-plan-day-1-heading");
    // The `<div>` DaySection.tsx marks `position: sticky` (direct child of
    // `section[data-day-index="0"]`), one level above the `<h2>` itself.
    const day0StickyHeader = page.locator("section[data-day-index='0'] > div.sticky");

    // `position: sticky` only pins an element once the page has scrolled past its
    // *natural* (unstuck) resting position — page content above the day stack
    // (the "Meal Plan" heading, mode badges, the buy-list button) means day 0's
    // header starts well below its eventual stuck offset. Reading bounding boxes
    // at scrollY 0 tells us nothing about whether stickiness actually works, so
    // compute how far we must scroll for it to have already engaged, and only
    // start measuring from there.
    const initialHeaderTop = await day0StickyHeader.evaluate((el) => {
      const top = parseFloat(getComputedStyle(el).top);
      return { rectTop: el.getBoundingClientRect().top, stickyOffset: Number.isNaN(top) ? 0 : top };
    });
    const engageScrollY = Math.ceil(initialHeaderTop.rectTop - initialHeaderTop.stickyOffset) + 40;

    await page.evaluate((y) => window.scrollTo(0, y), engageScrollY);
    await page.waitForTimeout(150);

    const day0Before = await day0Heading.boundingBox();
    const day1Before = await day1Heading.boundingBox();
    expect(day0Before).not.toBeNull();
    expect(day1Before).not.toBeNull();

    // Scroll further into day 0's content — enough to move day 1's heading up
    // noticeably, not so much that day 0's <section> (and so its sticky header)
    // scrolls fully out of the viewport.
    await page.evaluate(() => window.scrollBy(0, 150));
    await page.waitForTimeout(150);

    const day0After = await day0Heading.boundingBox();
    const day1After = await day1Heading.boundingBox();
    expect(day0After).not.toBeNull();
    expect(day1After).not.toBeNull();

    // Day 0's heading barely moves — `position: sticky` pins it near a fixed
    // viewport offset instead of scrolling away with its section's content.
    expect(Math.abs(day0After!.y - day0Before!.y)).toBeLessThan(20);
    // Day 1's heading, still below the fold and not yet stuck, moves up by roughly
    // the scroll delta.
    expect(day1Before!.y - day1After!.y).toBeGreaterThan(100);
  });
});
