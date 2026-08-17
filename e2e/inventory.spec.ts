import { test, expect } from "@playwright/test";
import { registerAs } from "./helpers";
import { TEST_USER, ITEMS } from "./fixtures";

/**
 * E2E Tests: Inventory Management
 */

test.describe("Inventory Management", () => {
  // Desktop only: mobile uses a tabbed layout — covered by mobile.spec.ts
  test("should show all three location columns", async ({ page, isMobile }) => {
    test.skip(isMobile, "Mobile uses tabs not columns — see mobile.spec.ts");

    const uniqueUser = {
      ...TEST_USER,
      email: `inventory+${Date.now()}@pantrymaid.test`,
    };

    await registerAs(page, uniqueUser);

    // Verify all three section headings are visible in the column layout
    await expect(page.getByTestId("section-pantry").getByText("Pantry")).toBeVisible();
    await expect(page.getByTestId("section-fridge").getByText("Fridge")).toBeVisible();
    await expect(page.getByTestId("section-freezer").getByText("Freezer")).toBeVisible();
  });

  test("should add item to pantry", async ({ page }) => {
    const uniqueUser = {
      ...TEST_USER,
      email: `pantry+${Date.now()}@pantrymaid.test`,
    };

    await registerAs(page, uniqueUser);

    // Find the Pantry section and click its + button
    const pantrySection = page.getByTestId("section-pantry");
    await pantrySection.locator('button:has([class*="lucide-plus"])').click();

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

    // Find the Fridge section and click its + button
    const fridgeSection = page.getByTestId("section-fridge");
    await fridgeSection.locator('button:has([class*="lucide-plus"])').click();

    // Wait for dialog to open
    await expect(page.locator('text="Add New Item"')).toBeVisible();

    // Fill in the form with expiry date. #expirationDate is a masked text
    // input (MM/DD/YYYY), not a native date input — page.fill() would bypass
    // the mask entirely and silently succeed against a fixture-shaped string
    // like "2026-04-15" (read as month "20" -> invalid -> field stays empty),
    // so use pressSequentially to actually exercise the mask.
    const [year, month, day] = (ITEMS.withExpiry.expiryDate ?? "").split("-");
    const digits = `${month}${day}${year}`; // MMDDYYYY, as a user would type it
    const maskedValue = `${month}/${day}/${year}`; // display value inside the field

    await page.fill("#name", ITEMS.withExpiry.name);
    await page.fill("#quantity", ITEMS.withExpiry.quantity.toString());
    const expiryInput = page.locator("#expirationDate");
    await expiryInput.click();
    await expiryInput.pressSequentially(digits);
    await expect(expiryInput).toHaveValue(maskedValue);

    // Submit the form
    await page.click('button:has-text("Add Item")');

    // Verify the item appears
    await expect(page.locator(`text="${ITEMS.withExpiry.name}"`)).toBeVisible();

    // Verify the expiry date actually made it onto the card, not just the
    // name. The card renders via toLocaleDateString(), which (en-US) omits
    // leading zeros, so build the match from numeric month/day rather than
    // asserting the zero-padded masked value again.
    //
    // Scope to fridgeSection rather than `div:has-text(...).first()`:
    // `:has-text` matches ANY ancestor containing the text, so `.first()`
    // would resolve to an outer wrapper containing every card in the
    // section, and an unanchored date regex could match a different item's
    // date and still pass. fridgeSection itself only contains this test's
    // one item, so scoping the search to it (rather than to a nested
    // `div:has-text` locator at all) is unambiguous. See commit 14398cd for
    // the same class of fix.
    const cardDatePattern = new RegExp(`${Number(month)}/${Number(day)}/${year}`);
    await expect(fridgeSection.getByText(cardDatePattern)).toBeVisible();
  });

  test("should delete an item", async ({ page }) => {
    const uniqueUser = {
      ...TEST_USER,
      email: `delete+${Date.now()}@pantrymaid.test`,
    };

    await registerAs(page, uniqueUser);

    // Add an item first
    const pantrySection = page.getByTestId("section-pantry");
    await pantrySection.locator('button:has([class*="lucide-plus"])').click();
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
