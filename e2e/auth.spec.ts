import { test, expect } from "@playwright/test";
import { loginAs, registerAs } from "./helpers";
import { TEST_USER } from "./fixtures";

/**
 * E2E Tests: Authentication Flow
 */

test.describe("Authentication Flow", () => {
  test.describe("Sign Up", () => {
    test("should sign up with email and password", async ({ page }) => {
      // Use unique email to avoid conflicts
      const uniqueUser = {
        ...TEST_USER,
        email: `tester+${Date.now()}@pantrymaid.test`,
      };

      await registerAs(page, uniqueUser);

      // Verify redirected to inventory page
      await expect(page).toHaveURL(/\/inventory/);

      // Verify welcome message is visible
      await expect(page.locator("text=Welcome")).toBeVisible();
    });
  });

  test.describe("Sign In", () => {
    test("should sign in with existing credentials", async ({ page, request }) => {
      // Create user via API first
      const uniqueUser = {
        ...TEST_USER,
        email: `signin+${Date.now()}@pantrymaid.test`,
      };

      const apiUrl = process.env.VITE_API_URL || "http://localhost:3000";
      await request.post(`${apiUrl}/api/auth/sign-up/email`, {
        data: {
          email: uniqueUser.email,
          password: uniqueUser.password,
          name: uniqueUser.name,
        },
      });

      // Now login via UI
      await loginAs(page, uniqueUser);

      // Verify we're on the inventory page
      await expect(page).toHaveURL(/\/inventory/);
    });

    test("should show error for invalid credentials", async ({ page }) => {
      await page.goto("/login");
      await page.fill("#email", "invalid@example.com");
      await page.fill("#password", "wrongpassword");
      await page.click('button:has-text("Sign In")');

      // Expect error message to be visible
      await expect(page.locator("text=error").or(page.locator("text=failed").or(page.locator("text=invalid")))).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Sign Out", () => {
    test("should sign out successfully", async ({ page }) => {
      // Create and login user
      const uniqueUser = {
        ...TEST_USER,
        email: `signout+${Date.now()}@pantrymaid.test`,
      };

      await registerAs(page, uniqueUser);

      // Click logout button (LogOut icon button in header)
      await page.click('button:has([class*="lucide-log-out"])');

      // Expect to be redirected to login page
      await expect(page).toHaveURL(/\/login/);
    });
  });
});
