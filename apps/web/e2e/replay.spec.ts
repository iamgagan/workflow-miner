import { test, expect } from "@playwright/test";

test.describe("Replay page", () => {
  test("loads successfully", async ({ page }) => {
    const response = await page.goto("/replay", { waitUntil: "networkidle" });
    expect(response?.status()).toBeLessThan(500);
  });

  test("shows empty state or replay content", async ({ page }) => {
    await page.goto("/replay", { waitUntil: "networkidle" });
    const heading = page.getByRole("heading", { name: "Workflow Replay" });
    await expect(heading).toBeVisible();
    await expect(page.getByText("No workflows to replay")).toBeVisible();
  });
});
