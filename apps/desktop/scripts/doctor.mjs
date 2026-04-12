#!/usr/bin/env node
/**
 * Workflow Miner desktop prerequisite checker.
 *
 * Run this before attempting the first `pnpm desktop:dev` / `desktop:build`
 * on a new Mac. It validates the toolchain and environment and prints a
 * clear checklist of what's missing. No installs, no guesses — just a
 * readable report so you know exactly what to fix.
 *
 * Usage:
 *   node apps/desktop/scripts/doctor.mjs
 *   # or from the repo root:
 *   pnpm --filter @workflow-miner/desktop exec node scripts/doctor.mjs
 *
 * Exit codes:
 *   0 — everything looks good
 *   1 — one or more required checks failed
 *   2 — one or more warnings (optional, proceed at your own risk)
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const desktopDir = resolve(repoRoot, "apps", "desktop");
const tauriDir = resolve(desktopDir, "src-tauri");

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

let errors = 0;
let warnings = 0;

function ok(label, detail = "") {
  process.stdout.write(`  ${GREEN}✓${RESET} ${label}${DIM}${detail ? "  " + detail : ""}${RESET}\n`);
}

function warn(label, hint = "") {
  warnings++;
  process.stdout.write(`  ${YELLOW}!${RESET} ${label}${hint ? `\n    ${DIM}${hint}${RESET}` : ""}\n`);
}

function fail(label, hint = "") {
  errors++;
  process.stdout.write(`  ${RED}✗${RESET} ${label}${hint ? `\n    ${DIM}${hint}${RESET}` : ""}\n`);
}

function section(title) {
  process.stdout.write(`\n${CYAN}▸ ${title}${RESET}\n`);
}

function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function versionOk(actual, minimum) {
  const a = actual.split(".").map((n) => parseInt(n, 10));
  const m = minimum.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < m.length; i++) {
    const av = a[i] ?? 0;
    if (av > m[i]) return true;
    if (av < m[i]) return false;
  }
  return true;
}

// ── Platform ──────────────────────────────────────────────────────────

section("Platform");
const plat = platform();
if (plat === "darwin") {
  ok(`macOS (${plat})`);
} else if (plat === "linux") {
  warn(
    `Running on Linux (${plat}) — the Tauri bundle is macOS-only.`,
    "Dev builds work for editing code, but you can't produce a .dmg here.",
  );
} else {
  fail(`Unsupported platform: ${plat}`);
}

// ── Node.js ──────────────────────────────────────────────────────────

section("Node.js");
const nodeVersion = process.versions.node;
if (versionOk(nodeVersion, "20.0.0")) {
  ok(`Node.js v${nodeVersion}`, "(>= 20.0.0 required)");
} else {
  fail(`Node.js v${nodeVersion} is too old`, "Install Node >= 20 via nvm or brew.");
}

// ── pnpm ──────────────────────────────────────────────────────────────

section("pnpm");
const pnpmVersion = tryExec("pnpm --version");
if (pnpmVersion) {
  if (versionOk(pnpmVersion, "8.0.0")) {
    ok(`pnpm v${pnpmVersion}`, "(>= 8.0.0 required)");
  } else {
    fail(`pnpm v${pnpmVersion} is too old`, "Upgrade with: npm install -g pnpm");
  }
} else {
  fail("pnpm not found in PATH", "Install with: brew install pnpm");
}

// ── Rust toolchain ────────────────────────────────────────────────────

section("Rust toolchain");
const rustcVersion = tryExec("rustc --version");
if (rustcVersion) {
  const match = rustcVersion.match(/rustc (\d+\.\d+\.\d+)/);
  const v = match?.[1];
  if (v && versionOk(v, "1.77.0")) {
    ok(`rustc ${v}`, "(>= 1.77.0 required)");
  } else {
    fail(
      `rustc ${v ?? rustcVersion} is too old`,
      "Update with: rustup update stable",
    );
  }
} else {
  fail(
    "rustc not found in PATH",
    "Install with: curl https://sh.rustup.rs -sSf | sh -s -- -y",
  );
}

const cargoVersion = tryExec("cargo --version");
if (cargoVersion) {
  ok(cargoVersion);
} else {
  fail("cargo not found in PATH", "Reinstall Rust via rustup.");
}

// Universal macOS targets — only required when doing the universal build.
if (plat === "darwin") {
  const targets = tryExec("rustup target list --installed");
  if (targets) {
    const lines = targets.split("\n").map((l) => l.trim());
    const hasArm = lines.includes("aarch64-apple-darwin");
    const hasIntel = lines.includes("x86_64-apple-darwin");
    if (hasArm && hasIntel) {
      ok("Both aarch64-apple-darwin and x86_64-apple-darwin targets installed");
    } else {
      warn(
        "Missing a Rust target for universal build",
        "Install with: rustup target add aarch64-apple-darwin x86_64-apple-darwin",
      );
    }
  }
}

// ── Tauri CLI ─────────────────────────────────────────────────────────

section("Tauri CLI");
const tauriInDesktop = existsSync(
  resolve(desktopDir, "node_modules", "@tauri-apps", "cli", "package.json"),
);
if (tauriInDesktop) {
  try {
    const pkg = JSON.parse(
      readFileSync(
        resolve(desktopDir, "node_modules", "@tauri-apps", "cli", "package.json"),
        "utf-8",
      ),
    );
    ok(`@tauri-apps/cli ${pkg.version} (local dep)`);
  } catch {
    ok("@tauri-apps/cli installed locally");
  }
} else {
  fail(
    "@tauri-apps/cli is not installed in apps/desktop",
    "Run: pnpm install  (from the repo root)",
  );
}

// ── Xcode Command Line Tools (macOS only) ────────────────────────────

if (plat === "darwin") {
  section("Xcode Command Line Tools");
  const xcodeCheck = spawnSync("xcode-select", ["-p"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (xcodeCheck.status === 0) {
    ok("Command Line Tools installed", xcodeCheck.stdout.toString().trim());
  } else {
    fail(
      "Xcode Command Line Tools not installed",
      "Install with: xcode-select --install",
    );
  }
}

// ── Icons ─────────────────────────────────────────────────────────────

section("App icons");
const iconsDir = resolve(tauriDir, "icons");
const sourceSvg = resolve(iconsDir, "source.svg");
const iconFiles = [
  "32x32.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.icns",
  "icon.ico",
];
const missingIcons = iconFiles.filter((f) => !existsSync(resolve(iconsDir, f)));

if (missingIcons.length === 0) {
  ok("All icon files present");
} else if (existsSync(sourceSvg)) {
  warn(
    `Missing ${missingIcons.length} icon file(s): ${missingIcons.join(", ")}`,
    "Generate from source.svg with: pnpm --filter @workflow-miner/desktop tauri icon src-tauri/icons/source.svg",
  );
} else {
  fail(
    "No icon source.svg and no generated icons present",
    "Commit a 1024x1024 source.svg (or source.png), then run `tauri icon`.",
  );
}

// ── Workspace install ─────────────────────────────────────────────────

section("Workspace install");
const enginePkg = resolve(repoRoot, "packages", "engine", "package.json");
const webPkg = resolve(repoRoot, "apps", "web", "package.json");
const enginePkgInstalled = existsSync(
  resolve(repoRoot, "packages", "engine", "node_modules"),
);
const webPkgInstalled = existsSync(
  resolve(repoRoot, "apps", "web", "node_modules"),
);
const desktopPkgInstalled = existsSync(
  resolve(desktopDir, "node_modules"),
);
if (!existsSync(enginePkg) || !existsSync(webPkg)) {
  fail("Missing packages/engine or apps/web — is this the right repo?");
} else if (enginePkgInstalled && webPkgInstalled && desktopPkgInstalled) {
  ok("pnpm install has been run in all three workspace packages");
} else {
  fail(
    "One or more workspace packages are not installed",
    "Run: pnpm install  (from the repo root)",
  );
}

// ── Engine build output ───────────────────────────────────────────────

section("Engine build output");
const engineDist = resolve(repoRoot, "packages", "engine", "dist");
if (existsSync(engineDist)) {
  ok("packages/engine/dist/ exists");
} else {
  warn(
    "packages/engine/dist/ is missing",
    "Run: pnpm --filter @workflow-miner/engine build",
  );
}

// ── Environment variables (desktop) ──────────────────────────────────

section("Google OAuth env vars (apps/desktop/.env.local)");
const envPath = resolve(desktopDir, ".env.local");
if (!existsSync(envPath)) {
  warn(
    "apps/desktop/.env.local is missing",
    "Copy from .env.example: cp apps/desktop/.env.example apps/desktop/.env.local",
  );
} else {
  const envContent = readFileSync(envPath, "utf-8");
  const hasClientId = /GMAIL_CLIENT_ID=\S+/.test(envContent);
  const hasClientSecret = /GMAIL_CLIENT_SECRET=\S+/.test(envContent);
  const hasPublicClientId = /NEXT_PUBLIC_GMAIL_CLIENT_ID=\S+/.test(envContent);
  if (hasClientId && hasClientSecret && hasPublicClientId) {
    ok("GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, NEXT_PUBLIC_GMAIL_CLIENT_ID set");
  } else {
    warn(
      "Some OAuth env vars are missing or empty",
      "Google connectors will be unavailable until GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / NEXT_PUBLIC_GMAIL_CLIENT_ID are set.",
    );
  }
}

// ── Summary ──────────────────────────────────────────────────────────

section("Summary");
if (errors === 0 && warnings === 0) {
  process.stdout.write(`  ${GREEN}All checks passed.${RESET} Ready for ${CYAN}pnpm desktop:dev${RESET}.\n\n`);
  process.exit(0);
}
if (errors > 0) {
  process.stdout.write(
    `  ${RED}${errors} error${errors === 1 ? "" : "s"}${RESET}` +
      (warnings > 0 ? ` and ${YELLOW}${warnings} warning${warnings === 1 ? "" : "s"}${RESET}` : "") +
      `. Fix the errors first, then re-run this script.\n\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `  ${YELLOW}${warnings} warning${warnings === 1 ? "" : "s"}${RESET} — you can proceed but some features may be unavailable.\n\n`,
);
process.exit(2);
