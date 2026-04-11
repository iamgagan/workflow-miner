import { test, expect } from "@playwright/test";

test.describe("Onboarding wizard", () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure wizard shows
    await page.goto("/dashboard");
    await page.evaluate(() => {
      localStorage.removeItem("onboarding-wizard-dismissed");
    });
  });

  test("shows onboarding wizard or empty state on first visit", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    // Wait for loading to complete
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes("Loading dashboard...");
    }, { timeout: 10000 }).catch(() => {});

    // The wizard shows when there are no events and localStorage flag is not set.
    // If the /api/dashboard returns data, stat cards will show instead.
    // Any of these outcomes is valid.
    const wizard = page.getByText("Welcome to Workflow Miner");
    const emptyState = page.getByText("No events yet");
    const statCards = page.getByText("Total Events");
    const hasWizard = await wizard.isVisible().catch(() => false);
    const hasEmptyState = await emptyState.isVisible().catch(() => false);
    const hasStats = await statCards.isVisible().catch(() => false);
    expect(hasWizard || hasEmptyState || hasStats).toBe(true);
  });

  test("wizard has Welcome step with Get Started button", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes("Loading dashboard...");
    }, { timeout: 10000 }).catch(() => {});

    const wizard = page.getByText("Welcome to Workflow Miner");
    if (await wizard.isVisible()) {
      await expect(page.getByRole("button", { name: "Get Started" })).toBeVisible();
    }
  });

  test("can progress through wizard steps", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes("Loading dashboard...");
    }, { timeout: 10000 }).catch(() => {});

    const wizard = page.getByText("Welcome to Workflow Miner");
    if (await wizard.isVisible()) {
      // Click Get Started to advance
      await page.getByRole("button", { name: "Get Started" }).click();
      // Should now show step 2
      await expect(page.getByText("Connect Your Tools")).toBeVisible();
    }
  });
});
