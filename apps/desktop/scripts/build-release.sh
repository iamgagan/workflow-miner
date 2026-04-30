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

# ── 4. Tauri build WITHOUT auto-notarization. We notarize manually after
#    deep-signing nested binaries (sharp, esbuild, libvips ship inside the
#    Next.js standalone bundle and Tauri's signing pass doesn't recurse
#    into Resources/_up_/resources/next/node_modules/). Pass APPLE_API_*
#    only to the notarytool step below — keeping them unset for tauri
#    build skips Tauri's premature notarization attempt.
echo "==> Tauri build (universal-apple-darwin)…"
export WORKFLOW_MINER_BUILD_TARGET=desktop
cd "$REPO_ROOT"
pnpm --filter @workflow-miner/engine build
WORKFLOW_MINER_BUILD_TARGET=desktop pnpm --filter web build
APPLE_API_KEY="" APPLE_API_ISSUER="" APPLE_API_KEY_PATH="" \
WORKFLOW_MINER_BUILD_TARGET=desktop pnpm --filter @workflow-miner/desktop \
  tauri build --target universal-apple-darwin || {
  echo "==> Tauri build exited non-zero — checking if .app was produced anyway"
}

APP="$DESKTOP_DIR/src-tauri/target/universal-apple-darwin/release/bundle/macos/Workflow Miner.app"
if [ ! -d "$APP" ]; then
  echo "ERROR: .app not produced at $APP"
  exit 1
fi

# ── 5. Deep-sign every nested Mach-O binary inside the .app. Tauri's
#    signing only covers Contents/MacOS/* — it doesn't recurse into the
#    Next.js resources tree where sharp/esbuild/libvips live. Apple
#    notary will reject without these.
echo "==> Deep-signing nested Mach-O binaries…"
SIGN_ID="Developer ID Application: Gagandeep Singh (48A323RMC9)"
LIST=$(mktemp); MACHO=$(mktemp)
find "$APP" \( -name "*.dylib" -o -name "*.node" -o -name "*.so" -o -type f -perm +111 \) -type f 2>/dev/null > "$LIST"
while IFS= read -r f; do
  if file "$f" 2>/dev/null | grep -qE "Mach-O"; then
    echo "$f" >> "$MACHO"
  fi
done < "$LIST"
COUNT=$(wc -l < "$MACHO" | tr -d ' ')
echo "  → $COUNT Mach-O binaries"
SIGNED=0
while IFS= read -r f; do
  codesign --force --options runtime --timestamp --sign "$SIGN_ID" "$f" 2>/dev/null && SIGNED=$((SIGNED+1))
done < "$MACHO"
echo "  → signed $SIGNED of $COUNT"
rm -f "$LIST" "$MACHO"

# Re-sign the .app bundle on top with hardened runtime + entitlements.
echo "==> Re-signing .app bundle (hardened runtime + entitlements)…"
codesign --force --options runtime --timestamp \
  --entitlements "$DESKTOP_DIR/src-tauri/entitlements.plist" \
  --sign "$SIGN_ID" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -3

# ── 6. Submit to Apple notary, wait for verdict, staple the ticket ──────
echo "==> Submitting to Apple notary…"
ZIP=$(mktemp -t wm-notarize).zip
ditto -c -k --keepParent "$APP" "$ZIP"

xcrun notarytool submit "$ZIP" \
  --key "$APPLE_API_KEY_PATH" \
  --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" \
  --wait --timeout 25m

echo "==> Stapling notarization ticket onto the .app…"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
rm -f "$ZIP"

# ── 7. Build the .dmg from the (now-notarized + stapled) .app ───────────
echo "==> Building .dmg…"
DMG_DIR="$DESKTOP_DIR/src-tauri/target/universal-apple-darwin/release/bundle/dmg"
mkdir -p "$DMG_DIR"
VERSION=$(grep '"version"' "$DESKTOP_DIR/src-tauri/tauri.conf.json" | head -1 | sed 's/[^"]*"version": "\([^"]*\)".*/\1/')
DMG="$DMG_DIR/Workflow Miner_${VERSION}_universal.dmg"
rm -f "$DMG"
STAGE=$(mktemp -d -t wm-dmg)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Workflow Miner" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

# Sign + staple the .dmg too (Gatekeeper checks .dmg signatures on download).
codesign --sign "$SIGN_ID" --timestamp "$DMG"
xcrun stapler staple "$DMG" || echo "  ! .dmg staple failed (notarization ticket may not cover the .dmg yet — friends will still be fine since the .app inside is stapled)"

echo ""
echo "==> Final Gatekeeper assessment…"
spctl --assess --type install --verbose "$DMG" 2>&1 | tail -3

echo ""
echo "✅ Build complete:"
echo "   $DMG"
ls -lh "$DMG"
shasum -a 256 "$DMG"
