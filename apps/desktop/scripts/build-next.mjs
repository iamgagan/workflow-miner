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
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
const envLocalSrc = resolve(webDir, ".env.local");
if (existsSync(envLocalSrc)) {
  const envDest = resolve(resourcesDir, "apps", "web", ".env.production");
  cpSync(envLocalSrc, envDest);
  console.log(`[build-next] embedded ${envLocalSrc} → ${envDest}`);
} else {
  console.warn(
    "[build-next] WARN: apps/web/.env.local not found — desktop OAuth flow will fail with 'server_oauth_not_configured'. Run /tmp/wire-oauth.sh or copy .env.local into apps/web/ before building.",
  );
}

console.log("[build-next] done");
