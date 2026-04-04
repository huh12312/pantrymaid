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

  // Debug logging before waitForURL
  console.log("After Sign In click - Current URL:", page.url());
  await page.waitForLoadState("networkidle");

  // Capture any visible error on the page
  const errorEl = await page.$(".text-destructive");
  if (errorEl) {
    const errorText = await errorEl.textContent();
    console.log("Page error message:", errorText);
  }

  const pageTitle = await page.title();
  console.log("Page title:", pageTitle);

  // Check for console errors
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  // Check for page errors
  const errors = await page.evaluate(() => {
    return (window as any).__errors || [];
  });

  if (errors.length) {
    console.log("Page errors:", errors);
  }
  if (consoleErrors.length) {
    console.log("Console errors:", consoleErrors);
  }

  await page.waitForURL("/inventory");
}

/**
 * Helper function to register a new user via the UI
 */
export async function registerAs(page: Page, user: User) {
  // Set up console and network logging BEFORE navigation
  const consoleMessages: string[] = [];
  const networkRequests: string[] = [];

  page.on("console", (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleMessages.push(text);
    console.log(text);
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/api/auth/sign-up")) {
      const status = response.status();
      const requestLog = `API Response: ${response.request().method()} ${url} - ${status}`;
      networkRequests.push(requestLog);
      console.log(requestLog);
      try {
        const body = await response.text();
        console.log("Response body:", body);
      } catch (e) {
        console.log("Could not read response body");
      }
    }
  });

  await page.goto("/login");
  // Click the toggle link to switch to sign up mode
  await page.click('button:has-text("Don\'t have an account? Sign up")');
  await page.fill("#name", user.name);
  await page.fill("#email", user.email);
  await page.fill("#password", user.password);
  await page.click('button:has-text("Sign Up")');

  // Debug logging before waitForURL
  console.log("After Sign Up click - Current URL:", page.url());
  await page.waitForLoadState("networkidle");

  // Capture any visible error on the page
  const errorEl = await page.$(".text-destructive");
  if (errorEl) {
    const errorText = await errorEl.textContent();
    console.log("Page error message:", errorText);
  }

  const pageTitle = await page.title();
  console.log("Page title:", pageTitle);

  // Dump all collected logs
  if (consoleMessages.length) {
    console.log("=== Console Messages ===");
    consoleMessages.forEach((msg) => console.log(msg));
  }
  if (networkRequests.length) {
    console.log("=== Network Requests ===");
    networkRequests.forEach((req) => console.log(req));
  }

  await page.waitForURL("/inventory");
}
