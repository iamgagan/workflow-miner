import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("config/loader", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Clear all connector env vars
    for (const key of [
      "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN",
      "SLACK_BOT_TOKEN", "LINEAR_API_KEY",
      "CALENDAR_CLIENT_ID", "CALENDAR_CLIENT_SECRET", "CALENDAR_REFRESH_TOKEN",
      "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS",
      "REPORT_TO_EMAIL", "REPORT_FROM_EMAIL",
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("loads empty config when no env vars or config file present", async () => {
    const { loadConfig } = await import("./loader.js");
    const config = loadConfig();
    expect(config.gmail).toBeUndefined();
    expect(config.slack).toBeUndefined();
  });

  it("throws on incomplete gmail credentials (all-or-nothing)", async () => {
    process.env.GMAIL_CLIENT_ID = "some-id";
    // Missing GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN

    const { loadConfig } = await import("./loader.js");
    expect(() => loadConfig()).toThrow("Incomplete gmail config");
  });

  it("throws on incomplete calendar credentials (all-or-nothing)", async () => {
    process.env.CALENDAR_CLIENT_ID = "some-id";
    // Missing CALENDAR_CLIENT_SECRET and CALENDAR_REFRESH_TOKEN

    const { loadConfig } = await import("./loader.js");
    expect(() => loadConfig()).toThrow("Incomplete calendar config");
  });

  it("validation errors do not leak secret values", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-super-secret-token-12345";
    process.env.GMAIL_CLIENT_ID = "id";
    process.env.GMAIL_CLIENT_SECRET = "secret";
    process.env.GMAIL_REFRESH_TOKEN = "token";
    // gmail fields are too short for min(1)? Actually they pass min(1).
    // Force a validation error through email with invalid email format
    process.env.SMTP_HOST = "localhost";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.REPORT_TO_EMAIL = "not-an-email";
    process.env.REPORT_FROM_EMAIL = "also-not-email";

    const { loadConfig } = await import("./loader.js");
    try {
      loadConfig();
      expect.unreachable("should have thrown");
    } catch (err: any) {
      // Error message should NOT contain the secret token
      expect(err.message).not.toContain("xoxb-super-secret-token-12345");
      expect(err.message).toContain("Invalid configuration");
    }
  });
});
