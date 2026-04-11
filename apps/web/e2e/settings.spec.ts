import { test, expect } from "@playwright/test";

test.describe("Settings page", () => {
  test("loads successfully", async ({ page }) => {
    const response = await page.goto("/settings", { waitUntil: "networkidle" });
    expect(response?.status()).toBeLessThan(500);
  });

  test("shows settings heading", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});
