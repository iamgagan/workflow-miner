#!/usr/bin/env node
/**
 * Production build helper for the Tauri shell.
 *
 * Tauri's `beforeBuildCommand` runs this before invoking `cargo build`. It:
 *   1. Builds the @workflow-miner/engine TypeScript package.
 *   2. Builds the apps/web Next.js app in standalone mode (so the production
 *      bundle is self-contained and doesn't need a separate node_modules
 *      tree at runtime).
 *   3. Copies the standalone output, the static assets, and the public/
 *      directory into apps/desktop/resources/next/, which Tauri then bundles
 *      into the .app under Resources/next/.
 *
 * Re-run this any time the engine or web app changes before building a new
 * .dmg.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Env vars that MUST NOT be embedded in the distributed .app. These either
 * grant direct billing access (LLM keys), bypass RLS (service role), or are
 * personal credentials that have no place in a binary shipped to other users.
 *
 * Anything not on this list is copied through. OAuth client_id/secret pairs
 * are intentionally NOT here — per RFC 8252 the desktop OAuth secret can be
 * embedded because security comes from the loopback redirect + PKCE.
 */
const FORBIDDEN_ENV_KEYS = new Set([
  "OPEN_ROUTER_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APPLE_API_KEY",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY_PATH",
  "GITHUB_EXPORT_PAT",
  "INNGEST_SIGNING_KEY",
  "INNGEST_EVENT_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
]);

/**
 * Read .env-format text and strip lines whose key is in FORBIDDEN_ENV_KEYS.
 * Returns { filtered: string, dropped: string[] }.
 */
function filterEnv(content) {
  const dropped = [];
  const lines = content.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m && FORBIDDEN_ENV_KEYS.has(m[1])) {
      dropped.push(m[1]);
      continue;
    }
    out.push(line);
  }
  return { filtered: out.join("\n"), dropped };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const engineDir = resolve(repoRoot, "packages", "engine");
const webDir = resolve(repoRoot, "apps", "web");
const desktopDir = resolve(repoRoot, "apps", "desktop");
const resourcesDir = resolve(desktopDir, "resources", "next");

function run(cmd, args, cwd) {
  console.log(`\n[build-next] $ ${cmd} ${args.join(" ")}  (cwd=${cwd})`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`[build-next] command failed with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

// 1. Build the engine first since the web app depends on its compiled output.
run("pnpm", ["--filter", "@workflow-miner/engine", "build"], repoRoot);

// 2. Build the Next.js app. Requires `output: "standalone"` in next.config.ts.
run("pnpm", ["--filter", "web", "build"], repoRoot);

// 3. Stage the standalone output into the Tauri resources directory.
if (existsSync(resourcesDir)) {
  rmSync(resourcesDir, { recursive: true, force: true });
}
mkdirSync(resourcesDir, { recursive: true });

const standaloneSrc = resolve(webDir, ".next", "standalone");
const staticSrc = resolve(webDir, ".next", "static");
const publicSrc = resolve(webDir, "public");

if (!existsSync(standaloneSrc)) {
  console.error(
    `[build-next] expected standalone build at ${standaloneSrc}. ` +
      `Make sure next.config.ts sets output: "standalone".`,
  );
  process.exit(1);
}

console.log(`[build-next] copying standalone bundle → ${resourcesDir}`);
// Preserve symlinks verbatim. pnpm's standalone tree relies on relative
// symlinks (apps/web/node_modules/next → ../../../node_modules/.pnpm/.../next)
// so that Next.js's peer-package resolution works (next finds styled-jsx,
// react, etc. as siblings inside the .pnpm tree). Default cpSync resolves
// relative symlinks to absolute paths that point outside the .app bundle,
// breaking everything. dereference: true would copy targets as real files
// but loses the .pnpm sibling structure → 'Cannot find module styled-jsx'.
// verbatimSymlinks: true keeps the relative paths intact so resolution
// stays within the bundle.
cpSync(standaloneSrc, resourcesDir, { recursive: true, verbatimSymlinks: true });

const standaloneNextStatic = resolve(resourcesDir, "apps", "web", ".next", "static");
mkdirSync(dirname(standaloneNextStatic), { recursive: true });
cpSync(staticSrc, standaloneNextStatic, { recursive: true });

if (existsSync(publicSrc)) {
  cpSync(publicSrc, resolve(resourcesDir, "apps", "web", "public"), { recursive: true });
}

// Copy apps/web/.env.local into the bundle as .env.production so the
// Next.js sidecar can read GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / etc. at
// runtime. These are needed by /api/connectors/google/exchange. Per RFC 8252
// the desktop OAuth client_secret can be safely embedded in distributed
// binaries because security comes from the loopback redirect + PKCE.
//
// Sensitive keys (LLM API keys, service role, personal Apple/GitHub creds)
// are stripped here — see FORBIDDEN_ENV_KEYS at top of file. The desktop
// reaches LLM features through the cloud /api/llm proxy with a per-install
// device token instead, so it never needs the underlying provider keys.
const envLocalSrc = resolve(webDir, ".env.local");
if (existsSync(envLocalSrc)) {
  const envDest = resolve(resourcesDir, "apps", "web", ".env.production");
  const raw = readFileSync(envLocalSrc, "utf8");
  const { filtered, dropped } = filterEnv(raw);
  writeFileSync(envDest, filtered, { encoding: "utf8", mode: 0o644 });
  console.log(
    `[build-next] embedded ${envLocalSrc} → ${envDest}` +
      (dropped.length > 0 ? ` (stripped: ${dropped.join(", ")})` : ""),
  );
} else {
  console.warn(
    "[build-next] WARN: apps/web/.env.local not found — desktop OAuth flow will fail with 'server_oauth_not_configured'. Run /tmp/wire-oauth.sh or copy .env.local into apps/web/ before building.",
  );
}

console.log("[build-next] done");
