import { test, expect } from "@playwright/test";
import { registerAs } from "./helpers";
import { TEST_USER, ITEMS } from "./fixtures";

/**
 * E2E Tests: Inventory Management
 */

test.describe("Inventory Management", () => {
  test("should show all three location columns", async ({ page }) => {
    const uniqueUser = {
      ...TEST_USER,
      email: `inventory+${Date.now()}@pantrymaid.test`,
    };

    await registerAs(page, uniqueUser);

    // Verify all three column headings are visible
    await expect(page.locator('text="Pantry"').first()).toBeVisible();
    await expect(page.locator('text="Fridge"').first()).toBeVisible();
    await expect(page.locator('text="Freezer"').first()).toBeVisible();
  });

  test("should add item to pantry", async ({ page }) => {
    const uniqueUser = {
      ...TEST_USER,
      email: `pantry+${Date.now()}@pantrymaid.test`,
    };

    await registerAs(page, uniqueUser);

    // Find the Pantry card and click its + button
    const pantryCard = page.locator('div:has(h3:text("Pantry"))').first();
    await pantryCard.locator('button:has([class*="lucide-plus"])').click();

    // Wait for dialog to open
    await expect(page.locator('text="Add New Item"')).toBeVisible();

    // Fill in the form
    await page.fill("#name", ITEMS.pantry.name);
    await page.fill("#quantity", ITEMS.pantry.quantity.toString());

    // Submit the form
    await page.click('button:has-text("Add Item")');

    // Verify the item appears in the pantry column
    await expect(page.locator(`text="${ITEMS.pantry.name}"`)).toBeVisible();
  });

  test("should add item to fridge with expiry date", async ({ page }) => {
    const uniqueUser = {
      ...TEST_USER,
      email: `fridge+${Date.now()}@pantrymaid.test`,
    };

    await registerAs(page, uniqueUser);

    // Find the Fridge card and click its + button
    const fridgeCard = page.locator('div:has(h3:text("Fridge"))').first();
    await fridgeCard.locator('button:has([class*="lucide-plus"])').click();

    // Wait for dialog to open
    await expect(page.locator('text="Add New Item"')).toBeVisible();

    // Fill in the form with expiry date
    await page.fill("#name", ITEMS.withExpiry.name);
    await page.fill("#quantity", ITEMS.withExpiry.quantity.toString());
    await page.fill("#expiryDate", ITEMS.withExpiry.expiryDate || "");

    // Submit the form
    await page.click('button:has-text("Add Item")');

    // Verify the item appears
    await expect(page.locator(`text="${ITEMS.withExpiry.name}"`)).toBeVisible();
  });

  test("should delete an item", async ({ page }) => {
    const uniqueUser = {
      ...TEST_USER,
      email: `delete+${Date.now()}@pantrymaid.test`,
    };

    await registerAs(page, uniqueUser);

    // Add an item first
    const pantryCard = page.locator('div:has(h3:text("Pantry"))').first();
    await pantryCard.locator('button:has([class*="lucide-plus"])').click();
    await expect(page.locator('text="Add New Item"')).toBeVisible();
    await page.fill("#name", "Item to Delete");
    await page.fill("#quantity", "1");
    await page.click('button:has-text("Add Item")');

    // Wait for item to appear
    await expect(page.locator('text="Item to Delete"')).toBeVisible();

    // Find and click the delete button (trash icon)
    const itemCard = page.locator('div:has-text("Item to Delete")').first();
    await itemCard.locator('button:has([class*="lucide-trash"])').click();

    // Verify the item is gone
    await expect(page.locator('text="Item to Delete"')).not.toBeVisible({ timeout: 5000 });
  });
});
