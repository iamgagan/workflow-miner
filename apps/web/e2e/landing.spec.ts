import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("loads with status 200", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("hero section is visible with 'Mine Your Workflows' text", async ({ page }) => {
    await page.goto("/");
    const heading = page.locator("h1");
    await expect(heading).toContainText("Mine Your");
    await expect(heading).toContainText("Workflows");
  });

  test("feature cards are present", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Mine", { exact: true })).toBeVisible();
    await expect(page.getByText("Review", { exact: true })).toBeVisible();
    await expect(page.getByText("Deploy", { exact: true })).toBeVisible();
  });

  test("download CTA is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Get Workflow Miner")).toBeVisible();
  });

  test("'Get Started' and 'See how it works' links exist", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Get Started/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /See how it works/i })).toBeVisible();
  });

  test("footer is present", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    await expect(footer).toBeVisible();
    await expect(footer).toContainText("Workflow Miner");
    await expect(footer).toContainText("All rights reserved");
  });
});
