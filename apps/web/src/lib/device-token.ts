/**
 * Desktop device token manager.
 *
 * Each desktop install gets a stable UUID + a server-issued Bearer token
 * that authenticates calls to /api/llm/[...path] (the cloud-hosted LLM
 * proxy). The token grants 100k tokens/month of LLM usage from the shared
 * Workflow Miner quota — no key paste, no signup, just internet.
 *
 * Storage:
 *   ~/Library/Application Support/WorkflowMiner/device-token.json
 *
 * The file is locked-down 0600 since possession of the token = use of
 * that device's quota. Worst-case theft: attacker burns 100k tokens
 * (max ~$0.40 at Haiku rates) before the period rolls.
 *
 * Lazy: the first call to getDeviceToken() reads disk; if missing,
 * generates a UUID, POSTs to /api/devices/register on the configured
 * proxy host, persists the result, and returns it. Subsequent calls
 * return the in-memory cache.
 *
 * No-ops in cloud mode — the cloud Next.js app talks directly to
 * OpenRouter / OpenAI with server-side keys.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const PROXY_HOST_DEFAULT = "https://workflow-miner.vercel.app";

interface StoredToken {
  readonly device_uuid: string;
  readonly token: string;
  readonly monthly_quota_tokens: number;
  readonly created_at: string;
}

let _cached: StoredToken | null = null;
let _inflight: Promise<StoredToken | null> | null = null;

function tokenFilePath(): string {
  const override = process.env.WORKFLOW_MINER_DEVICE_TOKEN_FILE;
  if (override) return override;

  const platform = os.platform();
  const home = os.homedir();
  if (platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "WorkflowMiner",
      "device-token.json",
    );
  }
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "WorkflowMiner", "device-token.json");
  }
  const xdg = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
  return path.join(xdg, "workflow-miner", "device-token.json");
}

function proxyHost(): string {
  return (
    process.env.WORKFLOW_MINER_PROXY_URL ??
    process.env.NEXT_PUBLIC_PROXY_URL ??
    PROXY_HOST_DEFAULT
  );
}

async function readFromDisk(): Promise<StoredToken | null> {
  try {
    const raw = await fs.readFile(tokenFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredToken>;
    if (
      typeof parsed.device_uuid === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.monthly_quota_tokens === "number" &&
      typeof parsed.created_at === "string"
    ) {
      return parsed as StoredToken;
    }
    return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error("[device-token] read failed:", err);
    return null;
  }
}

async function writeToDisk(token: StoredToken): Promise<void> {
  const file = tokenFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(token, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function registerNewDevice(): Promise<StoredToken | null> {
  const device_uuid = randomUUID();
  const url = `${proxyHost().replace(/\/$/, "")}/api/devices/register`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        device_uuid,
        platform: os.platform(),
        app_version: process.env.WORKFLOW_MINER_APP_VERSION ?? "unknown",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(
        `[device-token] register failed: ${res.status} ${text.slice(0, 200)}`,
      );
      return null;
    }
    const data = (await res.json()) as {
      token?: string;
      monthly_quota_tokens?: number;
    };
    if (typeof data.token !== "string" || data.token.length < 32) {
      console.error("[device-token] register returned malformed token");
      return null;
    }
    const stored: StoredToken = {
      device_uuid,
      token: data.token,
      monthly_quota_tokens: data.monthly_quota_tokens ?? 100000,
      created_at: new Date().toISOString(),
    };
    await writeToDisk(stored);
    return stored;
  } catch (err) {
    console.error("[device-token] register fetch failed:", err);
    return null;
  }
}

/**
 * Resolve the device token, registering with the cloud proxy if this is
 * the first launch. Returns null if registration fails (no internet,
 * proxy unreachable) — callers should treat that as "LLM features
 * unavailable" and fall back gracefully.
 */
export async function getDeviceToken(): Promise<StoredToken | null> {
  if (_cached) return _cached;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    const fromDisk = await readFromDisk();
    if (fromDisk) {
      _cached = fromDisk;
      return fromDisk;
    }
    const fresh = await registerNewDevice();
    _cached = fresh;
    return fresh;
  })();

  const result = await _inflight;
  _inflight = null;
  return result;
}

/**
 * Build the proxy URL for a given provider + sub-path.
 *   proxyUrl("openrouter", "chat/completions")
 *   → https://workflow-miner.vercel.app/api/llm/openrouter/chat/completions
 */
export function proxyUrl(provider: "openrouter" | "openai", subPath = ""): string {
  const base = proxyHost().replace(/\/$/, "");
  const cleanSub = subPath.replace(/^\//, "");
  return cleanSub
    ? `${base}/api/llm/${provider}/${cleanSub}`
    : `${base}/api/llm/${provider}`;
}
