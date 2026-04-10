import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { config as loadDotenv } from "dotenv";
import { configSchema, type Config } from "./schema.js";

const CONFIG_DIR = join(homedir(), ".workflow-miner");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

function readConfigFile(): Record<string, unknown> {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to read or parse config file at ${CONFIG_FILE}`);
  }
}

/**
 * Require all keys to be present if any are set (all-or-nothing).
 * Returns true if all keys have non-empty values, false if none are set.
 * Throws if only some keys are set.
 */
function requireAllOrNothing(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
  connectorName: string,
): boolean {
  const present = keys.filter((k) => env[k] && env[k]!.length > 0);
  if (present.length === 0) return false;
  if (present.length === keys.length) return true;
  const missing = keys.filter((k) => !present.includes(k));
  throw new Error(
    `Incomplete ${connectorName} config: missing ${missing.join(", ")}. Provide all or none.`,
  );
}

function buildConfigFromEnv(): Record<string, unknown> {
  const env = process.env;
  const config: Record<string, unknown> = {};

  if (requireAllOrNothing(env, ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"], "gmail")) {
    config.gmail = {
      clientId: env.GMAIL_CLIENT_ID,
      clientSecret: env.GMAIL_CLIENT_SECRET,
      refreshToken: env.GMAIL_REFRESH_TOKEN,
    };
  }

  if (env.SLACK_BOT_TOKEN) {
    config.slack = {
      botToken: env.SLACK_BOT_TOKEN,
    };
  }

  if (env.LINEAR_API_KEY) {
    config.linear = {
      apiKey: env.LINEAR_API_KEY,
    };
  }

  if (requireAllOrNothing(env, ["CALENDAR_CLIENT_ID", "CALENDAR_CLIENT_SECRET", "CALENDAR_REFRESH_TOKEN"], "calendar")) {
    config.calendar = {
      clientId: env.CALENDAR_CLIENT_ID,
      clientSecret: env.CALENDAR_CLIENT_SECRET,
      refreshToken: env.CALENDAR_REFRESH_TOKEN,
    };
  }

  if (env.SMTP_HOST || env.SMTP_USER) {
    config.email = {
      host: env.SMTP_HOST ?? "",
      port: env.SMTP_PORT ?? 587,
      user: env.SMTP_USER ?? "",
      pass: env.SMTP_PASS ?? "",
      toEmail: env.REPORT_TO_EMAIL ?? "",
      fromEmail: env.REPORT_FROM_EMAIL ?? "",
    };
  }

  return config;
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overVal = override[key];
    if (
      baseVal !== null &&
      overVal !== null &&
      typeof baseVal === "object" &&
      typeof overVal === "object" &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>,
      );
    } else {
      result[key] = overVal;
    }
  }
  return result;
}

/** Redact values that look like secrets from Zod error messages. */
function redactErrors(issues: readonly { message: string; path: (string | number)[] }[]): string {
  return issues
    .map((i) => {
      const path = i.path.join(".");
      return `  - ${path}: ${i.message}`;
    })
    .join("\n");
}

export function loadConfig(): Config {
  loadDotenv();

  const fileConfig = readConfigFile();
  const envConfig = buildConfigFromEnv();
  const merged = deepMerge(fileConfig, envConfig);

  const result = configSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${redactErrors(result.error.issues)}`);
  }
  return result.data;
}
