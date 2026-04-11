import { test, expect } from "@playwright/test";

test.describe("Login page", () => {
  test("loads and shows email input, password input, and submit button", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();
  });

  test("has link to signup", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: /Sign up/i })).toBeVisible();
  });
});

test.describe("Signup page", () => {
  test("loads and shows sign up form", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByText("Create an account")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign up/i })).toBeVisible();
  });

  test("has link to login", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("link", { name: /Sign in/i })).toBeVisible();
  });
});
