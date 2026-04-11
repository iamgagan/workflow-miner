import { test, expect } from "@playwright/test";

test.describe("Navigation & Theme", () => {
  test("top nav bar is visible on dashboard pages", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const header = page.locator("header");
    await expect(header).toBeVisible();
  });

  test("nav links exist for all sections", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const nav = page.locator("header nav");
    await expect(nav.getByRole("link", { name: /Dashboard/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Patterns/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Connectors/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Skills/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Replay/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Settings/i })).toBeVisible();
  });

  test("clicking nav links navigates to correct pages", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const nav = page.locator("header nav");

    await nav.getByRole("link", { name: /Patterns/i }).click();
    await expect(page).toHaveURL(/\/patterns/);

    await nav.getByRole("link", { name: /Connectors/i }).click();
    await expect(page).toHaveURL(/\/connectors/);

    await nav.getByRole("link", { name: /Skills/i }).click();
    await expect(page).toHaveURL(/\/skills/);
  });

  test("theme toggle button exists", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    // ThemeToggle renders a button with sr-only text "Toggle theme"
    const themeButton = page.getByRole("button", { name: /toggle theme/i });
    await expect(themeButton).toBeVisible();
  });

  test("logo links to homepage", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const logo = page.locator("header").getByRole("link", { name: /Workflow Miner/i });
    await expect(logo).toHaveAttribute("href", "/");
  });
});
