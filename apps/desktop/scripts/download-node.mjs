#!/usr/bin/env node
/**
 * Download the Node.js binaries the Tauri shell ships as a sidecar.
 *
 * Tauri's `externalBin` looks for files at
 *   src-tauri/binaries/<name>-<target-triple>
 * — for our case, `node-aarch64-apple-darwin` and `node-x86_64-apple-darwin`.
 * They're ~110MB each, so we keep them out of git and re-fetch on demand.
 *
 * Idempotent: if the file already exists and matches the expected version,
 * the download is skipped.
 *
 * Usage:
 *   node scripts/download-node.mjs               # both arches
 *   node scripts/download-node.mjs --arch=arm64  # just arm64
 *   node scripts/download-node.mjs --version=22.11.0
 */

import { existsSync, mkdirSync, createWriteStream, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const binariesDir = resolve(desktopDir, "src-tauri", "binaries");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);

const NODE_VERSION = args.version ?? "22.11.0";

// Map Tauri target triples to Node.js dist names.
const TARGETS = {
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-apple-darwin": "darwin-x64",
};

const wanted = args.arch
  ? Object.entries(TARGETS).filter(([triple]) => triple.includes(args.arch))
  : Object.entries(TARGETS);

mkdirSync(binariesDir, { recursive: true });

for (const [triple, distName] of wanted) {
  const targetPath = resolve(binariesDir, `node-${triple}`);

  if (existsSync(targetPath)) {
    const size = statSync(targetPath).size;
    if (size > 50_000_000) {
      console.log(`[download-node] ${triple}: already present (${(size / 1e6).toFixed(0)}MB) — skipping`);
      continue;
    }
    console.log(`[download-node] ${triple}: existing file looks truncated, re-downloading`);
  }

  const url = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${distName}.tar.xz`;
  const work = mkdtempSync(resolve(tmpdir(), "wm-node-"));
  const tarball = resolve(work, "node.tar.xz");

  console.log(`[download-node] ${triple}: fetching ${url}`);
  const dl = spawnSync("curl", ["-fsSL", "-o", tarball, url], { stdio: "inherit" });
  if (dl.status !== 0) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(`curl failed for ${url}`);
  }

  const ex = spawnSync("tar", ["-xf", tarball, "-C", work], { stdio: "inherit" });
  if (ex.status !== 0) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(`tar -xf failed for ${tarball}`);
  }

  const extracted = resolve(work, `node-v${NODE_VERSION}-${distName}`, "bin", "node");
  if (!existsSync(extracted)) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(`node binary not found at ${extracted}`);
  }

  const mv = spawnSync("mv", [extracted, targetPath], { stdio: "inherit" });
  if (mv.status !== 0) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(`mv failed`);
  }

  spawnSync("chmod", ["+x", targetPath], { stdio: "inherit" });
  rmSync(work, { recursive: true, force: true });

  const size = statSync(targetPath).size;
  console.log(`[download-node] ${triple}: ok (${(size / 1e6).toFixed(0)}MB)`);
}

// ── Build the universal binary for `tauri build --target universal-apple-darwin`
// Tauri's externalBin lookup for that target wants a single fat binary at
// `binaries/node-universal-apple-darwin`. lipo merges the per-arch ones.
const arm64Path = resolve(binariesDir, "node-aarch64-apple-darwin");
const x64Path = resolve(binariesDir, "node-x86_64-apple-darwin");
const universalPath = resolve(binariesDir, "node-universal-apple-darwin");

if (existsSync(arm64Path) && existsSync(x64Path)) {
  if (existsSync(universalPath)) {
    const size = statSync(universalPath).size;
    if (size > 100_000_000) {
      console.log(`[download-node] universal: already present (${(size / 1e6).toFixed(0)}MB) — skipping lipo`);
    } else {
      // Truncated — re-create.
      spawnSync("rm", ["-f", universalPath]);
    }
  }
  if (!existsSync(universalPath)) {
    console.log("[download-node] universal: lipo-merging arm64 + x86_64");
    const lipo = spawnSync("lipo", ["-create", arm64Path, x64Path, "-output", universalPath], { stdio: "inherit" });
    if (lipo.status !== 0) {
      throw new Error(`lipo failed (status ${lipo.status})`);
    }
    spawnSync("chmod", ["+x", universalPath], { stdio: "inherit" });
    const size = statSync(universalPath).size;
    console.log(`[download-node] universal: ok (${(size / 1e6).toFixed(0)}MB)`);
  }
}

console.log("[download-node] done");
