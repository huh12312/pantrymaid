import { type Page } from "@playwright/test";

interface User {
  email: string;
  name: string;
  password: string;
}

/**
 * Helper function to log in an existing user via the UI
 */
export async function loginAs(page: Page, user: User) {
  await page.goto("/login");
  await page.fill("#email", user.email);
  await page.fill("#password", user.password);
  await page.click('button:has-text("Sign In")');
  await page.waitForURL("/inventory");
}

/**
 * Helper function to register a new user via the UI
 */
export async function registerAs(page: Page, user: User) {
  await page.goto("/login");
  // Click the toggle link to switch to sign up mode
  await page.click('button:has-text("Don\'t have an account? Sign up")');
  await page.fill("#name", user.name);
  await page.fill("#email", user.email);
  await page.fill("#password", user.password);
  await page.click('button:has-text("Sign Up")');
  await page.waitForURL("/inventory");
}
