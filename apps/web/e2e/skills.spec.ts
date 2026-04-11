import { test, expect } from "@playwright/test";

test.describe("Skills page", () => {
  test("loads successfully", async ({ page }) => {
    const response = await page.goto("/skills", { waitUntil: "networkidle" });
    expect(response?.status()).toBeLessThan(500);
  });

  test("shows skill cards or empty state", async ({ page }) => {
    await page.goto("/skills", { waitUntil: "networkidle" });
    const emptyState = page.getByText("No skills generated yet");
    const heading = page.locator("main h1");
    await expect(heading).toContainText("Skills");
    // With empty skills array, we should see the empty state
    await expect(emptyState).toBeVisible();
  });

  test("filter badges are visible", async ({ page }) => {
    await page.goto("/skills", { waitUntil: "networkidle" });
    await expect(page.getByText("All", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await expect(page.getByText("Pending Review")).toBeVisible();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByText("Exported", { exact: true })).toBeVisible();
  });
});
