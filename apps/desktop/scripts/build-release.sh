#!/bin/bash
# Build a signed + notarized universal macOS .dmg for distribution.
#
# Prereqs (one-time):
#   1. "Developer ID Application: Gagandeep Singh (48A323RMC9)" cert in login keychain.
#      Verify with: security find-identity -v -p codesigning
#   2. App Store Connect API key (.p8) saved at ~/private_keys/AuthKey_<KEY_ID>.p8
#   3. Three env vars in your shell rc OR exported before invoking this script:
#         APPLE_API_KEY      — 10-char Key ID (e.g. U7M2W3XP9Q)
#         APPLE_API_ISSUER   — UUID Issuer ID
#         APPLE_API_KEY_PATH — absolute path to the .p8 file
#
# Usage:
#   ./apps/desktop/scripts/build-release.sh
#
# Output:
#   apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/Workflow*.dmg
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/apps/desktop"

echo "==> Workflow Miner: signed + notarized release build"

# ── 1. Sanity-check signing identity ────────────────────────────────────
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application: Gagandeep Singh (48A323RMC9)"; then
  echo "ERROR: 'Developer ID Application: Gagandeep Singh (48A323RMC9)' not found in keychain."
  echo "       Create it at https://developer.apple.com/account/resources/certificates/list"
  echo "       and double-click the downloaded .cer to install it."
  exit 1
fi
echo "  ✓ Developer ID Application cert present"

# ── 2. Sanity-check notarization credentials ────────────────────────────
: "${APPLE_API_KEY:?APPLE_API_KEY not set — set it to your App Store Connect Key ID}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER not set — set it to your App Store Connect Issuer ID UUID}"
: "${APPLE_API_KEY_PATH:?APPLE_API_KEY_PATH not set — set it to the absolute path of your AuthKey_*.p8}"

if [ ! -f "$APPLE_API_KEY_PATH" ]; then
  echo "ERROR: API key not found at $APPLE_API_KEY_PATH"
  exit 1
fi
echo "  ✓ Notarization credentials configured"

# ── 3. Ensure bundled Node binaries are present ─────────────────────────
echo "==> Ensuring bundled Node.js binaries…"
node "$DESKTOP_DIR/scripts/download-node.mjs"

# ── 4. Build universal — Tauri auto-signs and notarizes when the macOS ──
#    signingIdentity is set in tauri.conf.json AND the APPLE_API_* env
#    vars are present. Tauri 2 stables the notarization ticket
#    automatically on success.
echo "==> Tauri build (universal-apple-darwin)…"
export WORKFLOW_MINER_BUILD_TARGET=desktop
cd "$REPO_ROOT"
pnpm --filter @workflow-miner/engine build
WORKFLOW_MINER_BUILD_TARGET=desktop pnpm --filter web build
WORKFLOW_MINER_BUILD_TARGET=desktop pnpm --filter @workflow-miner/desktop \
  tauri build --target universal-apple-darwin

# ── 5. Locate the .dmg and report ───────────────────────────────────────
DMG=$(find "$DESKTOP_DIR/src-tauri/target/universal-apple-darwin/release/bundle/dmg" \
  -name "*.dmg" -type f 2>/dev/null | head -1)

if [ -z "$DMG" ] || [ ! -f "$DMG" ]; then
  echo "ERROR: build completed but no .dmg found in expected location"
  exit 1
fi

echo ""
echo "==> Verifying signature + notarization on the .dmg…"
spctl --assess --type install --verbose "$DMG" || {
  echo "WARN: spctl rejected the .dmg — notarization may have failed."
  echo "      Inspect with: xcrun notarytool log <submission-id> --key-id ..."
}

echo ""
echo "✅ Build complete:"
echo "   $DMG"
ls -lh "$DMG"
