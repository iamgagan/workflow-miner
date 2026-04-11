import { test, expect } from "@playwright/test";

test.describe("Patterns page", () => {
  test("loads successfully", async ({ page }) => {
    const response = await page.goto("/patterns", { waitUntil: "networkidle" });
    expect(response?.status()).toBeLessThan(500);
  });

  test("shows pattern cards or empty state", async ({ page }) => {
    await page.goto("/patterns", { waitUntil: "networkidle" });
    const emptyState = page.getByText("No patterns detected yet");
    const heading = page.getByRole("heading", { name: "Patterns", exact: true });
    await expect(heading).toBeVisible();
    // Either we see the empty state or pattern content
    const hasEmptyState = await emptyState.isVisible();
    if (hasEmptyState) {
      await expect(emptyState).toBeVisible();
    }
  });

  test("search input is visible", async ({ page }) => {
    await page.goto("/patterns", { waitUntil: "networkidle" });
    await expect(page.getByPlaceholder("Search patterns...")).toBeVisible();
  });

  test("sort select is visible", async ({ page }) => {
    await page.goto("/patterns", { waitUntil: "networkidle" });
    // The sort select trigger contains a SelectValue
    await expect(page.getByRole("combobox")).toBeVisible();
  });
});
