import { test, expect } from "@playwright/test";

test.describe("Connectors page", () => {
  test("loads successfully", async ({ page }) => {
    const response = await page.goto("/connectors", { waitUntil: "networkidle" });
    expect(response?.status()).toBeLessThan(500);
  });

  test("shows connector cards", async ({ page }) => {
    await page.goto("/connectors", { waitUntil: "networkidle" });
    // Use heading-level selectors scoped to the main content to avoid nav duplicates
    const main = page.locator("main");
    await expect(main.getByText("Gmail", { exact: true })).toBeVisible();
    await expect(main.getByText("Google Calendar")).toBeVisible();
    await expect(main.getByText("Team messages and channels")).toBeVisible();
    await expect(main.getByText("Issues and project tracking")).toBeVisible();
  });

  test("OAuth buttons are visible", async ({ page }) => {
    await page.goto("/connectors", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: /Add to Slack/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect Linear/i })).toBeVisible();
  });

  test("connected sources show Connected badge and Sync Now button", async ({ page }) => {
    await page.goto("/connectors", { waitUntil: "networkidle" });
    const connectedBadges = page.getByText("Connected", { exact: true });
    await expect(connectedBadges.first()).toBeVisible();
    const syncButtons = page.getByRole("button", { name: /Sync Now/i });
    await expect(syncButtons.first()).toBeVisible();
  });
});
