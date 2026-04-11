import { test, expect } from "@playwright/test";

test.describe("Connectors page", () => {
  test("loads successfully", async ({ page }) => {
    const response = await page.goto("/connectors", { waitUntil: "networkidle" });
    expect(response?.status()).toBeLessThan(500);
  });

  test("shows connector cards", async ({ page }) => {
    await page.goto("/connectors", { waitUntil: "networkidle" });
    const main = page.locator("main");
    await expect(main.getByText("Gmail", { exact: true })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Google Calendar" })).toBeVisible();
    await expect(main.getByText("Team messages and channels")).toBeVisible();
    await expect(main.getByText("Issues and project tracking")).toBeVisible();
  });

  test("OAuth buttons are visible for unconfigured connectors", async ({ page }) => {
    await page.goto("/connectors", { waitUntil: "networkidle" });
    // At minimum, Slack and Linear should show connect buttons
    await expect(page.getByRole("button", { name: /Add to Slack/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect Linear/i })).toBeVisible();
  });

  test("shows Not Configured or Connected status badges", async ({ page }) => {
    await page.goto("/connectors", { waitUntil: "networkidle" });
    // At least some connectors should show a status badge (Connected or Not Configured)
    const statusBadges = page.locator("text=Connected, text=Not Configured");
    const notConfiguredBadges = page.getByText("Not Configured");
    const connectedBadges = page.getByText("Connected", { exact: true });
    // Either some are connected or all show Not Configured
    const totalBadges = await notConfiguredBadges.count() + await connectedBadges.count();
    expect(totalBadges).toBeGreaterThanOrEqual(4);
  });
});
