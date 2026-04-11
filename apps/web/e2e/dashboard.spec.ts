import { test, expect } from "@playwright/test";

test.describe("Dashboard page", () => {
  test("loads or redirects to login", async ({ page }) => {
    const response = await page.goto("/dashboard", { waitUntil: "networkidle" });
    const url = page.url();
    // Either we're on /dashboard or redirected to /login
    expect(url).toMatch(/\/(dashboard|login)/);
    expect(response?.status()).toBeLessThan(500);
  });

  test("shows Dashboard heading or login page", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const url = page.url();
    if (url.includes("/dashboard")) {
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible();
    }
  });

  test("shows 'No events yet' empty state or stat cards", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const url = page.url();
    if (url.includes("/dashboard")) {
      // Wait for loading to finish
      await page.waitForFunction(() => {
        return !document.body.textContent?.includes("Loading dashboard...");
      }, { timeout: 10000 }).catch(() => {});

      const emptyState = page.getByText("No events yet");
      const statCards = page.getByText("Total Events");
      const onboarding = page.getByText("Welcome to Workflow Miner");
      // One of these should be visible
      const hasContent = await emptyState.isVisible()
        || await statCards.isVisible()
        || await onboarding.isVisible();
      expect(hasContent).toBe(true);
    }
  });
});
