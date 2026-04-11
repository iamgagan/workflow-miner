#!/usr/bin/env node
/**
 * Bootstrap script for the Next.js sidecar inside the Tauri shell.
 *
 * This is invoked by `apps/desktop/src-tauri/src/sidecar.rs` after the Rust
 * shell has picked a free loopback port and resolved the per-user data
 * directory. The Rust side passes everything via environment variables:
 *
 *   PORT                       — TCP port to bind on 127.0.0.1
 *   WORKFLOW_MINER_MODE        — set to "desktop" so the supabase shim
 *                                kicks in via local-shim.ts
 *   WORKFLOW_MINER_DATA_DIR    — directory for the PGlite brain DB
 *   NEXT_PUBLIC_APP_URL        — full base URL the renderer will see; passed
 *                                to OAuth redirect builders so the loopback
 *                                callback URL matches the bound port
 *   NODE_ENV                   — "production" or "development"
 *
 * In dev mode (CLI flag --dev) it spawns `next dev`. Otherwise it spawns
 * `next start` against the precompiled `.next` directory.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev");

const port = process.env.PORT ?? "1420";
const mode = process.env.WORKFLOW_MINER_MODE ?? "desktop";
const dataDir = process.env.WORKFLOW_MINER_DATA_DIR ?? "";
const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `http://127.0.0.1:${port}`;

// Resolve the Next.js app directory. The Rust side calls us from inside
// `apps/web/` already (cwd is set), so we just check that `.next` exists for
// production. In dev we use `next dev`.
const cwd = process.cwd();
const nextBin = resolve(cwd, "node_modules/.bin/next");

if (!existsSync(nextBin)) {
  console.error(
    `[run-next] could not find next binary at ${nextBin}. ` +
      `Did you run 'pnpm install' in apps/web?`,
  );
  process.exit(1);
}

if (!isDev && !existsSync(resolve(cwd, ".next"))) {
  console.error(
    `[run-next] no .next build found in ${cwd}. ` +
      `Run 'pnpm --filter web build' before launching the desktop shell in production mode.`,
  );
  process.exit(1);
}

const args = isDev ? ["dev", "-p", port, "-H", "127.0.0.1"] : ["start", "-p", port, "-H", "127.0.0.1"];

const env = {
  ...process.env,
  PORT: port,
  HOSTNAME: "127.0.0.1",
  WORKFLOW_MINER_MODE: mode,
  WORKFLOW_MINER_DATA_DIR: dataDir,
  NEXT_PUBLIC_APP_URL: baseUrl,
  // Force Next to bind only to loopback so the desktop server isn't
  // accidentally exposed on the local network.
  NEXT_TELEMETRY_DISABLED: "1",
};

console.log(`[run-next] launching: next ${args.join(" ")}`);
console.log(`[run-next] mode=${mode} data=${dataDir} base=${baseUrl}`);

const child = spawn(nextBin, args, {
  cwd,
  env,
  stdio: "inherit",
});

const shutdown = (signal) => {
  console.log(`[run-next] received ${signal}, terminating next.js`);
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code, signal) => {
  console.log(`[run-next] next.js exited code=${code} signal=${signal ?? "none"}`);
  process.exit(code ?? 0);
});
